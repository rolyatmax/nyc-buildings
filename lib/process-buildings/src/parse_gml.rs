use earcutr::earcut;
use nom::bytes::complete::{tag, take_until};
use nom::IResult;
use std::collections::{HashMap, HashSet};
use std::fs::read_to_string;
use std::path::PathBuf;

#[derive(Debug)]
pub struct Building {
    pub bin: u32,
    pub vertices: Vec<f32>,
    pub triangles: Vec<u32>,
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
            // eprintln!("pos_list: {:?}", pos_list);
            // panic!();
            continue;
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

pub fn parse_gml_to_buildings(filepaths: Vec<PathBuf>) -> Vec<Building> {
    let mut buildings: Vec<Building> = Vec::with_capacity(100); //  vec![];

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
            buildings.push(building);
        }
    }
    buildings
}
