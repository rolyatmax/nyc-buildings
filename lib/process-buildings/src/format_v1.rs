use super::parse_gml::Building;
use bytebuffer::ByteBuffer;
use std::io::{stdout, BufWriter, StdoutLock, Write};

const MAX_U16: u32 = u32::pow(2, 16) - 1;
const VERSION: [u8; 3] = [0, 1, 1];

/*
Output data format:
---- HEADER ----
version major - u8
version minor - u8
version patch - u8
empty - u8
vertexCount - uint32
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

pub fn write_v1_output(buildings: Vec<Building>) -> () {
    let buildings_count: u32 = buildings.len() as u32;
    let vertex_count: u32 = buildings
        .iter()
        .map(|b| (b.vertices.len() / 3) as u32)
        .sum();
    let triangle_count: u32 = buildings
        .iter()
        .map(|b| (b.triangles.len() / 3) as u32)
        .sum();
    let stdout = stdout().lock();
    let mut buf_writer = BufWriter::new(stdout);

    /*
       ---- HEADER ----
       version major - u8
       version minor - u8
       version patch - u8
       empty - u8
       vertexCount - uint32
       triangleCount - uint32
       buildingCount - uint32
    */
    let mut header = ByteBuffer::new();
    header.write_bytes(&VERSION);
    header.write_u8(0);
    header.write_bytes(&u32::to_le_bytes(vertex_count));
    header.write_bytes(&u32::to_le_bytes(triangle_count));
    header.write_bytes(&u32::to_le_bytes(buildings_count));
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
