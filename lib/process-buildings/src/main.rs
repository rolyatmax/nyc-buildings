// ./process-buildings models/DA13_3D_Buildings.gml > output.bin

use bytebuffer::ByteBuffer;
use clap::Parser;
use earcutr::earcut;
use nom::bytes::complete::{tag, take_until};
use nom::IResult;
use std::collections::{HashMap, HashSet};
use std::env::current_dir;
use std::fs::{canonicalize, read_to_string};
use std::io::{stdout, StdoutLock, Write};

const MAX_U16: u32 = u32::pow(2, 16) - 1;

/*
Output data format:
---- HEADER ---- (THIS SHOULD BE ADDED IN ANOTHER SCRIPT. THIS SCRIPT ONLY OUTPUTS THE BODY.)
triangleCount - uint32
buildingCount - uint32
----- BODY ----
buildingByteLength - uint32
buildingId - uint32
vertexCount - uint32
vertexA - float32x3
vertexB - float32x3
...
triangleCount - uint32
triA - uint8x3 (or uint16x3 if vertexCount > 255)
triB - uint8x3 (or uint16x3 if vertexCount > 255)
...
repeat with next building

*/

#[derive(Parser)]
struct Opts {
    #[clap()]
    file: String,
}

#[derive(Debug)]
struct Building {
    bin: u32,
    vertices: Vec<f32>,
    triangles: Vec<u32>,
}

fn strip_through_tag(input: &str, tag_str: String) -> IResult<&str, &str> {
    let (input, _) = take_until(tag_str.as_str())(input)?;
    let (input, _) = tag(tag_str.as_str())(input)?;
    Ok((input, ""))
}

fn get_tag_contents(input: &str, tag_str: String) -> IResult<&str, &str> {
    let open_tag = format!("<{tag_str}");
    let (input, _) = strip_through_tag(input, open_tag)?;
    let (input, _) = strip_through_tag(input, ">".to_string())?;

    let close_tag = format!("</{tag_str}>");
    let (input, contents) = take_until(close_tag.as_str())(input)?;
    let (input, _) = strip_through_tag(input, close_tag)?;
    Ok((input, contents))
}

fn coord_to_string(coord: &[f64]) -> String {
    let c: Vec<String> = coord.clone().iter().map(|v| v.to_string()).collect();
    c.join(",")
}

fn parse_building(input: &str) -> IResult<&str, Building> {
    let (input, _) = strip_through_tag(input, "<gen:stringAttribute name=\"BIN\">".to_string())?;
    let (input, bin) = get_tag_contents(input, "gen:value".to_string())?;
    let mut left = input;

    let mut idx = 0;
    let mut vertex_to_idx: HashMap<String, usize> = HashMap::new();
    let mut vertices: Vec<f64> = vec![];
    let mut triangles: Vec<u32> = vec![];

    loop {
        let pos_list = match get_tag_contents(left, "gml:posList".to_string()) {
            Ok((leftover, pos_list)) => {
                left = leftover;
                pos_list
            }
            _ => {
                break;
            }
        };
        let pos_list = pos_list.trim();
        let pos_list = pos_list.split_whitespace();
        let pos_list = pos_list.map(|v| v.parse().expect("Could not parse number as f64"));
        let mut pos_list: Vec<f64> = pos_list.collect();
        pos_list.truncate(pos_list.len() - 3);

        let mut x_dim_set: HashSet<String> = HashSet::new();
        let mut y_dim_set: HashSet<String> = HashSet::new();
        let mut z_dim_set: HashSet<String> = HashSet::new();

        assert!(
            pos_list.len() % 3 == 0 && pos_list.len() > 0,
            "pos_list should be divisible by 3 and greater than 0"
        );

        for pos in pos_list.chunks_exact(3) {
            let name = coord_to_string(pos);
            if !vertex_to_idx.contains_key(&name) {
                vertices.push(pos[0]);
                vertices.push(pos[1]);
                vertices.push(pos[2]);
                vertex_to_idx.insert(name, idx);
                idx += 1;
            }
            x_dim_set.insert(pos[0].to_string());
            y_dim_set.insert(pos[1].to_string());
            z_dim_set.insert(pos[2].to_string());
        }

        // now, take the pos_list and use earcutr to produce a list of triangles
        let pt_indices = match pos_list.len() {
            9 => vec![0, 1, 2],
            12 => vec![0, 1, 2, 0, 2, 3],
            _ => {
                let mut pos_list_2d: Vec<f64> = Vec::new();
                for c in pos_list.chunks_exact(3) {
                    if x_dim_set.len() == 1 {
                        pos_list_2d.push(c[1]);
                        pos_list_2d.push(c[2]);
                    } else if y_dim_set.len() == 1 {
                        pos_list_2d.push(c[0]);
                        pos_list_2d.push(c[2]);
                    } else {
                        pos_list_2d.push(c[0]);
                        pos_list_2d.push(c[1]);
                    }
                }
                // earcutr doesn't ACTUALLY work with 3 dimensions,
                // so we chop it down to 2 dims in a way that doesn't flatten it into a line
                earcut(&pos_list_2d, &[], 2).expect("earcut failed :-(")
            }
        };

        if pt_indices.len() < 3 {
            eprintln!("earcut results were 0-length?");
            eprintln!("pt_indices: {:?}", pt_indices);
            eprintln!(
                "x,y,z unique val count: {:?}",
                (x_dim_set.len(), y_dim_set.len(), z_dim_set.len())
            );
            eprintln!("pos_list: {:?}", pos_list);
            panic!();
        }

        for idx in pt_indices {
            let coord = [
                pos_list[idx * 3],
                pos_list[idx * 3 + 1],
                pos_list[idx * 3 + 2],
            ];
            let name = coord_to_string(&coord);
            let vertex_idx = vertex_to_idx
                .get(&name)
                .expect("Unable to find vertex index from hashmap!");
            triangles.push(
                vertex_idx
                    .to_owned()
                    .try_into()
                    .expect("Unable to convert vertex_idx to u32"),
            );
        }
    }

    let bin: u32 = bin.parse().expect("Expected BIN to be parsable as a u32");
    let vertices: Vec<f32> = vertices.iter().map(|v| *v as f32).collect();
    let building = Building {
        vertices,
        triangles,
        bin,
    };
    Ok(("", building))
}

fn write_building(mut stdout: StdoutLock, building: Building) -> () {
    /*
    buildingByteLength (not including this value) - uint32
    buildingId - uint32
    vertexCount - uint32
    vertexA - float32x3
    vertexB - float32x3
    ...
    triangleCount - uint32
    triA - uint8x3 (or uint16x3 if vertexCount > 255)
    triB - uint8x3 (or uint16x3 if vertexCount > 255)
    ...
     */
    let vertex_count: u32 = (building.vertices.len() / 3) as u32;
    let triangle_count: u32 = (building.triangles.len() / 3) as u32;
    let triangle_idx_bytelength = if vertex_count > 255 { 2 } else { 1 };
    assert!(
        vertex_count <= MAX_U16,
        "Building {} has {} vertices! That's more than 2^16",
        building.bin,
        vertex_count
    );

    let mut buffer = ByteBuffer::new();
    buffer.write_u32(building.bin);
    buffer.write_u32(vertex_count);
    for f in building.vertices {
        buffer.write_f32(f);
    }
    buffer.write_u32(triangle_count);
    if vertex_count <= 255 {
        for t in building.triangles {
            buffer.write_u8(t as u8);
        }
    } else {
        for t in building.triangles {
            buffer.write_u16(t as u16);
        }
    }

    let building_byte_length =
        4 + 4 + vertex_count * 12 + 4 + triangle_idx_bytelength * 3 * triangle_count;
    assert!(
        building_byte_length as usize == buffer.len(),
        "expected building byte length and buffer length to be the same"
    );

    stdout
        .write_all(&building_byte_length.to_be_bytes())
        .expect("Failed to write building byte length to stdout");
    stdout
        .write_all(buffer.as_bytes())
        .expect("Failed to write building data to stdout");
}

fn main() {
    let Opts { file } = Opts::parse();

    let cwd = current_dir().unwrap();
    let cwd = cwd.as_path();
    let filepath = cwd.join(file.clone());
    let filepath = canonicalize(filepath.clone()).expect("File {file} not found.");

    let contents = read_to_string(filepath).expect("Was unable to read file");

    let mut left = contents.as_str();
    let mut vertex_count = 0;
    let mut triangle_count = 0;
    let mut building_count = 0;

    let tag_str = if contents.contains("core:cityObjectMember") {
        "core:cityObjectMember"
    } else {
        "cityObjectMember"
    };
    let tag_str = tag_str.to_string();

    loop {
        let building_str = match get_tag_contents(&left, tag_str.clone()) {
            Ok((leftover, building_str)) => {
                left = leftover;
                building_str
            }
            _ => {
                break;
            }
        };

        let (_, building) = parse_building(building_str).expect("Failed to parse building");

        building_count += 1;
        vertex_count += building.vertices.len() / 3;
        triangle_count += building.triangles.len() / 3;

        write_building(stdout().lock(), building);
    }

    eprintln!("YAY! ALL DONE! LET'S SEE HOW MANY BUILDINGS WE FOUND:");
    eprintln!("building count: {:?}", building_count);
    eprintln!("vertex count: {:?}", vertex_count);
    eprintln!("triangle count: {:?}", triangle_count);
}
