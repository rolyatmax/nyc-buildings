// ./process-buildings models/DA13_3D_Buildings.gml > output.bin
// OR
// ./process-buildings --info models/output.bin

use bytebuffer::ByteBuffer;
use clap::{Parser, ValueEnum};
use format_v1::write_v1_output;
use parse_gml::parse_gml_to_buildings;
use std::env::current_dir;
use std::fs::{canonicalize, File};
use std::io::Read;
use std::path::PathBuf;

mod format_v1;
mod parse_gml;

#[derive(Debug, Clone, ValueEnum)]
enum OutputFormat {
    V1,
}

#[derive(Parser)]
struct Opts {
    /// Only works with v2 formats
    #[clap(long)]
    info: bool,

    #[clap(short, long, default_value = "v1")]
    format: OutputFormat,

    #[clap()]
    files: Vec<String>,
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

    let mut vertex_count: [u8; 4] = [0; 4];
    header
        .read_exact(&mut vertex_count)
        .expect("Unable to read vertex count");
    let vertex_count = u32::from_le_bytes(vertex_count);

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
    eprintln!("vertex count: {}", vertex_count);
    eprintln!("triangle count: {}", triangle_count);
    eprintln!("building count: {}", buildings_count);
}

fn main() {
    let Opts {
        info,
        files,
        format,
    } = Opts::parse();

    let cwd = current_dir().unwrap();
    let cwd = cwd.as_path();

    let filepaths: Vec<PathBuf> = files
        .iter()
        .map(|f| {
            let filepath = cwd.join(f);
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
        let buildings = parse_gml_to_buildings(filepaths);
        match format {
            OutputFormat::V1 => write_v1_output(buildings),
        }
    }
}
