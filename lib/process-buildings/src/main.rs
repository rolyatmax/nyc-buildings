// ./process-buildings models/DA13_3D_Buildings.gml > output.bin
// OR
// ./process-buildings --info models/output.bin

use bytebuffer::ByteBuffer;
use clap::Parser;
use earcutr::earcut;
use nom::bytes::complete::{tag, take_until};
use nom::IResult;
use std::collections::{HashMap, HashSet};
use std::env::current_dir;
use std::fs::{canonicalize, read_to_string, File};
use std::io::{stdout, BufWriter, Read, StdoutLock, Write};
use std::path::PathBuf;

const MAX_U16: u32 = u32::pow(2, 16) - 1;
const VERSION: [u8; 3] = [0, 1, 0];

/*
Output data format:
---- HEADER ----
version major - u8
version minor - u8
version patch - u8
empty - u8
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
possible padding here to make align with 4 bytes
...
repeat with next building

*/

#[derive(Parser)]
struct Opts {
    #[clap(long)]
    info: bool,

    #[clap()]
    files: Vec<String>,
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

fn parse_building(input: &str) -> IResult<&str, Building> {
    let (input, _) = strip_through_tag(input, "<gen:stringAttribute name=\"BIN\">".to_string())?;
    let (input, bin) = get_tag_contents(input, "gen:value".to_string())?;
    let mut left = input;

    let mut idx = 0;
    let mut vertex_to_idx: HashMap<String, usize> = HashMap::new();
    let mut vertices: Vec<f32> = Vec::with_capacity(8);
    let mut triangles: Vec<u32> = Vec::with_capacity(10);

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
        let mut pos_list: Vec<&str> = pos_list.split_whitespace().collect();
        pos_list.truncate(pos_list.len() - 3);
        let pos_list_chunks = pos_list.chunks_exact(3);

        let mut x_dim_set: HashSet<&str> = HashSet::new();
        let mut y_dim_set: HashSet<&str> = HashSet::new();
        let mut z_dim_set: HashSet<&str> = HashSet::new();

        assert!(
            pos_list.len() % 3 == 0 && pos_list.len() > 0,
            "pos_list should be divisible by 3 and greater than 0"
        );

        for pos in pos_list_chunks.clone() {
            let x: f32 = pos[0].parse().expect("Could not parse x as f32");
            let y: f32 = pos[1].parse().expect("Could not parse y as f32");
            let z: f32 = pos[2].parse().expect("Could not parse z as f32");
            let name = pos.join("|");
            if !vertex_to_idx.contains_key(&name) {
                vertices.push(x);
                vertices.push(y);
                vertices.push(z);
                vertex_to_idx.insert(name, idx);
                idx += 1;
            }
            x_dim_set.insert(pos[0]);
            y_dim_set.insert(pos[1]);
            z_dim_set.insert(pos[2]);
        }

        // now, take the pos_list and use earcutr to produce a list of triangles
        let pos_list_len = pos_list.len();
        let pt_indices = match pos_list_len {
            9 => vec![0, 1, 2],
            12 => vec![0, 1, 2, 0, 2, 3],
            _ => {
                let mut pos_list_2d: Vec<f32> = Vec::with_capacity(pos_list_len / 3 * 2);
                for c in pos_list_chunks {
                    let x: f32 = c[0].parse().expect("Could not parse x as f32");
                    let y: f32 = c[1].parse().expect("Could not parse y as f32");
                    let z: f32 = c[2].parse().expect("Could not parse z as f32");
                    if x_dim_set.len() == 1 {
                        pos_list_2d.push(y);
                        pos_list_2d.push(z);
                    } else if y_dim_set.len() == 1 {
                        pos_list_2d.push(x);
                        pos_list_2d.push(z);
                    } else {
                        pos_list_2d.push(x);
                        pos_list_2d.push(y);
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
            let name = coord.join("|");
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

fn write_building(buf_writer: &mut BufWriter<StdoutLock>, building: Building) -> () {
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
    buffer.write_bytes(&u32::to_le_bytes(building.bin));
    buffer.write_bytes(&u32::to_le_bytes(vertex_count));
    for f in building.vertices {
        buffer.write_bytes(&f32::to_le_bytes(f));
    }
    buffer.write_bytes(&u32::to_le_bytes(triangle_count));
    if vertex_count <= 255 {
        for t in building.triangles {
            buffer.write_u8(t as u8);
        }
    } else {
        for t in building.triangles {
            buffer.write_bytes(&u16::to_le_bytes(t as u16));
        }
    }

    let triangle_list_in_bytes = triangle_idx_bytelength * 3 * triangle_count;
    let padding = (4 - (triangle_list_in_bytes % 4)) % 4;
    let mut n = padding;
    while n > 0 {
        buffer.write_u8(0);
        n -= 1;
    }

    let building_byte_length =
        4 + 4 + vertex_count * 12 + 4 + triangle_idx_bytelength * 3 * triangle_count + padding;
    assert!(
        building_byte_length as usize == buffer.len(),
        "expected building byte length and buffer length to be the same"
    );
    assert!(
        buffer.len() % 4 == 0,
        "Expected building bytelength to be divisible by 4"
    );

    buf_writer
        .write_all(&building_byte_length.to_le_bytes())
        .expect("Failed to write building byte length to stdout");
    buf_writer
        .write_all(buffer.as_bytes())
        .expect("Failed to write building data to stdout");
}

fn parse_gml_to_stdout(filepaths: Vec<PathBuf>) -> () {
    let mut buildings: Vec<Building> = Vec::with_capacity(100); //  vec![];
    let mut vertex_count = 0;
    let mut triangle_count = 0;

    for filepath in filepaths {
        let contents = read_to_string(&filepath).expect("Was unable to read file");

        let mut left = contents.as_str();

        let tag_str = if contents.contains("core:cityObjectMember") {
            "core:cityObjectMember"
        } else {
            "cityObjectMember"
        };

        loop {
            let building_str = match get_tag_contents(&left, tag_str.to_string()) {
                Ok((leftover, building_str)) => {
                    left = leftover;
                    building_str
                }
                _ => {
                    break;
                }
            };

            let (_, building) = parse_building(building_str).expect("Failed to parse building");

            vertex_count += &building.vertices.len() / 3;
            triangle_count += &building.triangles.len() / 3;
            buildings.push(building);
        }
    }

    let buildings_count = buildings.len();

    let stdout = stdout().lock();
    let mut buf_writer = BufWriter::new(stdout);

    /*
       ---- HEADER ----
       version major - u8
       version minor - u8
       version patch - u8
       empty - u8
       triangleCount - uint32
       buildingCount - uint32
    */
    let mut header = ByteBuffer::new();
    header.write_bytes(&VERSION);
    header.write_u8(0);
    header.write_bytes(&u32::to_le_bytes(triangle_count as u32));
    header.write_bytes(&u32::to_le_bytes(buildings_count as u32));
    buf_writer
        .write_all(header.as_bytes())
        .expect("Failed to write header to stdout");

    // Then, write all the buildings
    for building in buildings {
        write_building(&mut buf_writer, building);
    }

    eprintln!("YAY! ALL DONE! LET'S SEE HOW MANY BUILDINGS WE FOUND:");
    eprintln!("building count: {:?}", buildings_count);
    eprintln!("vertex count: {:?}", vertex_count);
    eprintln!("triangle count: {:?}", triangle_count);
}

fn get_info(filepath: &PathBuf) -> () {
    let mut file = File::open(&filepath).expect("Was unable to open file");

    let mut contents: [u8; 12] = [0; 12];
    file.read_exact(&mut contents)
        .expect("Was unable to read file");
    let mut header = ByteBuffer::from_bytes(&contents);
    let version_major = header.read_u8().unwrap();
    let version_minor = header.read_u8().unwrap();
    let version_patch = header.read_u8().unwrap();
    let empty = header.read_u8().unwrap();

    assert!(
        empty == 0,
        "Header does not have expected values - may not be the right format"
    );

    let mut triangle_count: [u8; 4] = [0; 4];
    header
        .read_exact(&mut triangle_count)
        .expect("Unable to read triangle count");
    let triangle_count = u32::from_le_bytes(triangle_count);

    let mut buildings_count: [u8; 4] = [0; 4];
    header
        .read_exact(&mut buildings_count)
        .expect("Unable to read buildings count");
    let buildings_count = u32::from_le_bytes(buildings_count);

    eprintln!(
        "file version: {}.{}.{}",
        version_major, version_minor, version_patch
    );
    eprintln!("triangle count: {}", triangle_count);
    eprintln!("building count: {:?}", buildings_count);
}

fn main() {
    let Opts { info, files } = Opts::parse();

    let cwd = current_dir().unwrap();
    let cwd = cwd.as_path();

    let filepaths: Vec<PathBuf> = files
        .iter()
        .map(|f| {
            let filepath = cwd.clone().join(f);
            canonicalize(&filepath).expect("File {file} not found.")
        })
        .collect();

    if info {
        assert!(
            filepaths.len() == 1,
            "Can only get info for one file at a time."
        );
        get_info(&filepaths[0]);
    } else {
        parse_gml_to_stdout(filepaths);
    }
}
