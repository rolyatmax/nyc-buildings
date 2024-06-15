
/*

Client-side code for decoding the following data format in Uint8 chunks.

Usage:

    const decoder = new StreamDecoder()
    decoder.onChunk(uint8Array) // call on every chunk (whether loading from a Socket or a BodyReader stream, etc)
    const result: Result = decoder.getCurrentResult()
    decoder.done // this will be true when all data expected from the header is done processing

Data format (v0.1.0):

---- HEADER ----
version major - u8
version minor - u8
version patch - u8
empty - u8
vertexCount - uint32
triangleCount - uint32
buildingCount - uint32
-----
buildingByteLength - uint32
buildingId - uint32
vertexCount - uint32
vertexA - float32x3
vertexB - float32x3
...
triangleCount - uint32
triA - uint8x3 (or uint16x3 if vertexCount > 255)
triB - uint8x3 (or uint16x3 if vertexCount > 255)
Possible padding here to make this list align to 4bytes
...
repeat with next building

*/

type Result = {
  vertices: Float32Array
  // TODO: support barycentric coords - maybe on the next version of the data?
  // barys: Float32Array
  indexes: Uint32Array
  buildingIds: Uint32Array
  buildingsProcessed: number
  trianglesProcessed: number
  verticesProcessed: number
  buildingCount: number
  triangleCount: number
  version: string
}

const HEADER_SIZE = 16

export default class StreamDecoder {
  private result: Result | null = null
  private leftoverChunk: Uint8Array | null = null
  public done: Boolean = false
  public onChunk (chunk: Uint8Array): void {
    chunk = this.mergeWithLeftoverChunk(chunk)

    const needsHeader = this.result === null
    if (needsHeader) {
      if (chunk.length < HEADER_SIZE) {
        this.leftoverChunk = chunk.slice() // TODO: DO I NEED TO COPY THIS?
        return
      }
      this.processHeader(new Uint8Array(chunk.buffer, chunk.byteOffset, HEADER_SIZE))
      chunk = new Uint8Array(chunk.buffer, chunk.byteOffset + HEADER_SIZE)
    }

    while (true) {
      if (chunk.length === 0) break
      const dataview = new DataView(chunk.buffer, chunk.byteOffset)
      const buildingByteLength = dataview.getUint32(0, true)
      // see if this chunk contains the data for the entire building (minus 4 bytes for the
      // buildingByteLength uint32 - which isn't included in the count)
      // if not, then stick all of it in the leftoverChunk and try again on the next tick
      if (chunk.length < buildingByteLength + 4) {
        this.leftoverChunk = chunk.slice() // TODO: DO I NEED TO COPY THIS?
        break
      }
      this.processBuilding(new Uint8Array(chunk.buffer, chunk.byteOffset + 4, buildingByteLength))
      chunk = new Uint8Array(chunk.buffer, chunk.byteOffset + 4 + buildingByteLength)
    }

    if (this.result && this.result.buildingsProcessed === this.result.buildingCount) {
      this.done = true
      if (chunk.length !== 0) throw new Error('Decoding data failed: processed all buildings with data left over')
    }
  }

  private mergeWithLeftoverChunk (chunk: Uint8Array): Uint8Array {
    if (!this.leftoverChunk || this.leftoverChunk.length === 0) {
      return chunk
    }
    // TODO: CREATE A DATASTRUCTURE THAT HOLDS 2+ BUFFERS AND CAN PROCESS THEM WITHOUT
    // HAVING TO DO COPIES TO MERGE THE TWO BUFFERS INTO ONE
    const newChunk = new Uint8Array(this.leftoverChunk.length + chunk.length)
    newChunk.set(this.leftoverChunk, 0)
    newChunk.set(chunk, this.leftoverChunk.length)
    this.leftoverChunk = null
    return newChunk
  }

  private processBuilding (chunk: Uint8Array): void {
    if (!this.result) throw new Error('Decoding data failed: tried processing building before header')

    const dataview = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    let i = 0
    const buildingId = dataview.getUint32(i, true)
    const vertexCount = dataview.getUint32(i + 4, true)
    const vertices = new Float32Array(chunk.buffer, chunk.byteOffset + 8, vertexCount * 3)
    i += 8 + vertices.byteLength
    const triangleCount = dataview.getUint32(i, true)
    i += 4
    const TypedArray = vertexCount > 255 ? Uint16Array : Uint8Array
    const triangles = new TypedArray(chunk.buffer, chunk.byteOffset + i, triangleCount * 3)

    const triangleListInBytes = TypedArray.BYTES_PER_ELEMENT * triangleCount * 3
    const expectedPadding = (4 - triangleListInBytes % 4) % 4
    // the chunk should have been completely consumed after the list of triangles + expectedPadding
    if (chunk.byteLength !== i + triangles.byteLength + expectedPadding) {
      throw new Error('Decoding data failed: building data has leftover bytes after processing')
    }

    const lastVertex = this.result.verticesProcessed
    const lastVertexIdx = lastVertex * 3
    this.result.vertices.set(vertices, lastVertexIdx)

    for (let k = 0; k < vertexCount; k++) {
      this.result.buildingIds[this.result.verticesProcessed + k] = buildingId
    }

    this.result.verticesProcessed += vertexCount

    for (let j = 0; j < triangles.length; j += 3) {
      const idx = this.result.trianglesProcessed * 3
      this.result.indexes[idx] = triangles[j] + lastVertex
      this.result.indexes[idx + 1] = triangles[j + 1] + lastVertex
      this.result.indexes[idx + 2] = triangles[j + 2] + lastVertex
      this.result.trianglesProcessed += 1
    }

    this.result.buildingsProcessed += 1
  }

  private processHeader (chunk: Uint8Array): void {
    const dataview = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const version = `${chunk[0]}.${chunk[1]}.${chunk[2]}`
    if (chunk[3] !== 0) throw new Error('Decoding data failed: invalid header')
    const vertexCount = dataview.getUint32(4, true)
    const triangleCount = dataview.getUint32(8, true)
    const buildingCount = dataview.getUint32(12, true)
    const indexCount = triangleCount * 3
    console.log({ version, triangleCount, buildingCount, vertexCount, indexCount })
    this.result = {
      vertices: new Float32Array(vertexCount * 3),
      indexes: new Uint32Array(indexCount),
      buildingIds: new Uint32Array(vertexCount),
      buildingsProcessed: 0,
      trianglesProcessed: 0,
      verticesProcessed: 0,
      buildingCount,
      triangleCount,
      version
    }
  }

  public getCurrentResult (): Result | null {
    return this.result
  }
}
