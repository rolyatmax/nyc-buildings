/*

-----------------------------------------------------------
NOTE: THIS CODE IS ONLY TO BE USED AS REFERENCE
-----------------------------------------------------------

Data format (v0.1.0):

---- HEADER ----
version major - u8
version minor - u8
version patch - u8
empty - u8
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
...
repeat with next building

*/

type Vec3 = [number, number, number] | number[] | Float32Array

type Metadata = {
  centroid: Vec3
  height: number
}

type GetLatestResult = {
  positions: Float32Array
  barys: Float32Array
  buildings: Float32Array
  randoms: Float32Array
  buildingIdxToMetadataList: Metadata[]
  verticesProcessed: number
}

type OnStart = (getLatest: () => GetLatestResult) => void
type OnDone = (latest: GetLatestResult) => void
type MungeData = (res: Response) => Promise<void>

const BUILDING_DELIMITER = [255, 255, 255, 255]
const VERTEX_LIST_DELIMITER = [254, 255, 255, 255]

export function createDataMunger (vertexCount: number, onStart: OnStart, onDone: OnDone): MungeData {
  const positions = new Float32Array(vertexCount * 3)
  const buildings = new Float32Array(vertexCount)
  const barys = new Float32Array(vertexCount * 3)
  const randoms = new Float32Array(vertexCount)
  const buildingIdxToMetadataList: Metadata[] = []

  let verticesProcessed = 0

  function getLatest (): GetLatestResult {
    return { positions, barys, buildings, randoms, buildingIdxToMetadataList, verticesProcessed }
  }

  return async function mungeData (meshRes: Response) {
    let isFirstChunk = true
    let isLastChunk = false
    if (!meshRes.body?.getReader) {
      const m = await meshRes.arrayBuffer()
      isFirstChunk = isLastChunk = true
      processChunk(new Uint8Array(m))
      onStart(getLatest)
      setTimeout(() => onDone(getLatest()), 0)
      return
    }

    let buildingCount = 0
    let vertices: Float32Array
    let curVertIdxByteSize: 1 | 2 | null = null
    let sectionStart: number
    let p: number
    let leftoverChunk: Uint8Array

    const reader = meshRes.body.getReader()

    processStream(await reader.read()).catch((err) => {
      const msg: string = err ? err.toString() : 'no error passed to catch()'
      console.error(`An error occurred while processing stream: ${msg}`)
    })

    async function processStream ({ done, value }: ReadableStreamReadResult<Uint8Array>): Promise<void> {
      if (isFirstChunk) {
        if (value) processChunk(value)
        onStart(getLatest)
        isFirstChunk = false
      } else {
        requestIdleCallback(() => {
          if (done) isLastChunk = true
          if (value) processChunk(value)
          if (done) {
            requestIdleCallback(() => onDone(getLatest()))
          }
        })
      }
      if (!done) {
        processStream(await reader.read()).catch((err) => {
          const msg: string = err ? err.toString() : 'no error passed to catch()'
          console.error(`An error occurred while processing stream: ${msg}`)
        })
      }
    }

    // lengths: {positions: 32895792, buildings: 10965264, barys: 32895792, randoms: 10965264}
    // positions = new Float32Array(positions)
    // buildings = new Uint32Array(buildings)
    // barys = new Float32Array(barys)
    // randoms = new Float32Array(randoms)

    // ------------------------------------------------
    // ------------ processing functions
    // ------------------------------------------------

    function processChunk (chunk: Uint8Array): void {
      if (isFirstChunk && chunk) {
        // curBuildingID = new Uint32Array(chunk.slice(0, 4).buffer)[0]
        sectionStart = 4
        p = 4
      }

      if (!chunk) {
        chunk = leftoverChunk
        leftoverChunk = new Uint8Array()
      }

      if (leftoverChunk.length) {
        const newChunk = new Uint8Array(leftoverChunk.length + chunk.length)
        newChunk.set(leftoverChunk)
        newChunk.set(chunk, leftoverChunk.length)
        chunk = newChunk
        leftoverChunk = new Uint8Array()
      }

      const stopAt = isLastChunk ? chunk.length : chunk.length - 8

      while (p < stopAt) {
        // vertex list delimiter
        if (
          chunk[p] === VERTEX_LIST_DELIMITER[0] &&
          chunk[p + 1] === VERTEX_LIST_DELIMITER[1] &&
          chunk[p + 2] === VERTEX_LIST_DELIMITER[2] &&
          chunk[p + 3] === VERTEX_LIST_DELIMITER[3] &&
          (p - sectionStart) % (4 * 3) === 0 &&
          curVertIdxByteSize === null
        ) {
          processBuildingVertices(chunk, sectionStart, p)
          curVertIdxByteSize = chunk[p + 4] === 0 ? 1 : 2
          p += 5
          sectionStart = p
          continue
        }

        // building delimiter
        if (
          chunk[p] === BUILDING_DELIMITER[0] &&
          chunk[p + 1] === BUILDING_DELIMITER[1] &&
          chunk[p + 2] === BUILDING_DELIMITER[2] &&
          chunk[p + 3] === BUILDING_DELIMITER[3] &&
          curVertIdxByteSize !== null &&
          (p - sectionStart) % (curVertIdxByteSize * 3) === 0
        ) {
          processBuildingTriangles(chunk, sectionStart, p, curVertIdxByteSize)
          curVertIdxByteSize = null
          // curBuildingID = new Uint32Array(chunk.slice(p + 4, p + 8).buffer)[0]
          p += 8
          buildingCount += 1
          sectionStart = p
          continue
        }

        p += 1
      }

      leftoverChunk = chunk.slice(sectionStart)
      p -= sectionStart
      sectionStart = 0
    }

    function processBuildingVertices (buf: Uint8Array, sectionStart: number, sectionEnd: number): void {
      const b = buf.slice(sectionStart, sectionEnd)
      vertices = new Float32Array(b.buffer)
      if (vertices.length % 3 !== 0) {
        throw new Error('ACK! Something is wrong with the vertices!')
      }
    }

    function processBuildingTriangles (
      buf: Uint8Array,
      sectionStart: number,
      sectionEnd: number,
      vertIdxByteSize: 1 | 2
    ): void {
      const buildingEntropyValue = Math.random()

      const b = buf.slice(sectionStart, sectionEnd)
      const TypedArray = vertIdxByteSize === 1 ? Uint8Array : Uint16Array
      const vertIndexes = new TypedArray(b.buffer)

      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 0; i < vertices.length; i += 3) {
        // For DA_WISE dataset
        // mins: [ 978979.241500825, 194479.073690146, -39.0158999999985 ]
        // maxs: [ 1009996.30348232, 259992.617531568, 1797.1066 ]
        vertices[i] = (vertices[i] - 978979) / 1000
        vertices[i + 1] = (vertices[i + 1] - 194479) / 1000
        vertices[i + 2] = (vertices[i + 2] - -39.5) / 1000

        minX = Math.min(minX, vertices[i])
        maxX = Math.max(maxX, vertices[i])
        minY = Math.min(minY, vertices[i + 1])
        maxY = Math.max(maxY, vertices[i + 1])
        minZ = Math.min(minZ, vertices[i + 2])
        maxZ = Math.max(maxZ, vertices[i + 2])
      }

      const centroid = [(maxX + minX) / 2, (maxY + minY) / 2, (maxZ + minZ) / 2]
      const height = maxZ - minZ
      buildingIdxToMetadataList.push({ centroid, height })

      if (vertIndexes.length % 3 !== 0) {
        throw new Error('ACK! Something is wrong with the triangles!')
      }

      for (let j = 0; j < vertIndexes.length; j += 3) {
        const v1Idx = vertIndexes[j]
        const v2Idx = vertIndexes[j + 1]
        const v3Idx = vertIndexes[j + 2]

        if (
          !checkVertex(
            vertices[v1Idx * 3 + 0],
            vertices[v1Idx * 3 + 1],
            vertices[v1Idx * 3 + 2]
          ) ||
          !checkVertex(
            vertices[v2Idx * 3 + 0],
            vertices[v2Idx * 3 + 1],
            vertices[v2Idx * 3 + 2]
          ) ||
          !checkVertex(
            vertices[v3Idx * 3 + 0],
            vertices[v3Idx * 3 + 1],
            vertices[v3Idx * 3 + 2]
          )
        ) {
          return
        }

        const n = verticesProcessed / 3
        verticesProcessed += 3

        positions[n * 9 + 0] = vertices[v1Idx * 3 + 0]
        positions[n * 9 + 1] = vertices[v1Idx * 3 + 1]
        positions[n * 9 + 2] = vertices[v1Idx * 3 + 2]
        positions[n * 9 + 3] = vertices[v2Idx * 3 + 0]
        positions[n * 9 + 4] = vertices[v2Idx * 3 + 1]
        positions[n * 9 + 5] = vertices[v2Idx * 3 + 2]
        positions[n * 9 + 6] = vertices[v3Idx * 3 + 0]
        positions[n * 9 + 7] = vertices[v3Idx * 3 + 1]
        positions[n * 9 + 8] = vertices[v3Idx * 3 + 2]

        barys[n * 9 + 0] = 0
        barys[n * 9 + 1] = 0
        barys[n * 9 + 2] = 1
        barys[n * 9 + 3] = 0
        barys[n * 9 + 4] = 1
        barys[n * 9 + 5] = 0
        barys[n * 9 + 6] = 1
        barys[n * 9 + 7] = 0
        barys[n * 9 + 8] = 0

        buildings[n * 3 + 0] = buildingCount
        buildings[n * 3 + 1] = buildingCount
        buildings[n * 3 + 2] = buildingCount

        randoms[n * 3 + 0] = buildingEntropyValue
        randoms[n * 3 + 1] = buildingEntropyValue
        randoms[n * 3 + 2] = buildingEntropyValue
      }
    }

    function checkVertex (x: number, y: number, z: number): boolean {
      if (x < 0 || y < 0 || z < 0) {
        console.log(
          `Something wrong with this vertex: ${x}, ${y}, ${z} - building ${buildingCount}`
        )
        return false
      }
      return true
    }
  }
}
