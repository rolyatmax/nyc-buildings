const getNormal = require('triangle-normal')

const BUILDING_DELIMITER = [255, 255, 255, 255]
const VERTEX_LIST_DELIMITER = [254, 255, 255, 255]

module.exports = function createMesh(buffer) {
  const buf = new Uint8Array(buffer)

  const positions = []
  const normals = []
  const buildings = []
  const barys = []
  const buildingBinToIdxMap = {}
  const buildingIdxToBinMap = []
  const buildingIdxToHeight = []
  const buildingIdxToWidth = []
  const buildingIdxToMinX = []
  const buildingIdxToMinZ = []
  let buildingCount = 0
  let curNormal = [] // reuse this array
  let vertices = [] // reuse this array

  let curVertIdxByteSize = null
  let curBuildingID = new Uint32Array(buf.slice(0, 4).buffer)[0]
  let chunkStart = 4
  let p = 4
  while (p < buf.length) {
    // vertex list delimiter
    if (
      buf[p] === VERTEX_LIST_DELIMITER[0] &&
      buf[p + 1] === VERTEX_LIST_DELIMITER[1] &&
      buf[p + 2] === VERTEX_LIST_DELIMITER[2] &&
      buf[p + 3] === VERTEX_LIST_DELIMITER[3] &&
      (p - chunkStart) % (4 * 3) === 0 &&
      curVertIdxByteSize === null
    ) {
      processBuildingVertices(chunkStart, p)
      curVertIdxByteSize = buf[p + 4] === 0 ? 1 : 2
      p += 5
      chunkStart = p
      continue
    }

    // building delimiter
    if (
      buf[p] === BUILDING_DELIMITER[0] &&
      buf[p + 1] === BUILDING_DELIMITER[1] &&
      buf[p + 2] === BUILDING_DELIMITER[2] &&
      buf[p + 3] === BUILDING_DELIMITER[3] &&
      curVertIdxByteSize !== null &&
      (p - chunkStart) % (curVertIdxByteSize * 3) === 0
    ) {
      processBuildingTriangles(chunkStart, p, curVertIdxByteSize, curBuildingID)
      curVertIdxByteSize = null
      curBuildingID = new Uint32Array(buf.slice(p + 4, p + 8).buffer)[0]
      p += 8
      buildingCount += 1
      chunkStart = p
      continue
    }

    p += 1
  }

  if (chunkStart !== p) {
    console.log('chunkStart does not equal p!')
    console.log('chunkStart:', chunkStart)
    console.log('p:', p)
    console.log('buildingCount:', buildingCount)
    throw new Error('UGHHHHHH')
  }

  function processBuildingVertices(chunkStart, chunkEnd) {
    const b = buf.slice(chunkStart, chunkEnd)
    vertices = new Float32Array(b.buffer)
    if (vertices.length % 3 !== 0) {
      throw new Error('ACK! Something is wrong with the vertices!')
    }
  }

  function processBuildingTriangles(
    chunkStart,
    chunkEnd,
    vertIdxByteSize,
    buildingID
  ) {
    // if (buildingCount > 1000) return
    buildingIdxToBinMap[buildingCount] = buildingID
    buildingBinToIdxMap[buildingID] = buildingCount
    const b = buf.slice(chunkStart, chunkEnd)
    const TypedArray = vertIdxByteSize === 1 ? Uint8Array : Uint16Array
    const vertIndexes = new TypedArray(b.buffer)

    let minX = Infinity
    let maxX = -Infinity
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
      minZ = Math.min(minZ, vertices[i + 2])
      maxZ = Math.max(maxZ, vertices[i + 2])

      // vertices[i] += (Math.random() * 2 - 1) * 0.05
      // vertices[i + 1] += (Math.random() * 2 - 1) * 0.05
      // vertices[i + 2] += (Math.random() * 2 - 1) * 0.05
    }

    buildingIdxToWidth[buildingCount] = maxX - minX
    buildingIdxToMinX[buildingCount] = minX
    buildingIdxToHeight[buildingCount] = maxZ - minZ
    buildingIdxToMinZ[buildingCount] = minZ

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

      positions.push(
        vertices[v1Idx * 3 + 0],
        vertices[v1Idx * 3 + 1],
        vertices[v1Idx * 3 + 2],
        vertices[v2Idx * 3 + 0],
        vertices[v2Idx * 3 + 1],
        vertices[v2Idx * 3 + 2],
        vertices[v3Idx * 3 + 0],
        vertices[v3Idx * 3 + 1],
        vertices[v3Idx * 3 + 2]
      )

      barys.push(0, 0, 1, 0, 1, 0, 1, 0, 0)

      buildings.push(buildingCount, buildingCount, buildingCount)

      getNormal(
        vertices[v1Idx * 3 + 0],
        vertices[v1Idx * 3 + 1],
        vertices[v1Idx * 3 + 2],
        vertices[v2Idx * 3 + 0],
        vertices[v2Idx * 3 + 1],
        vertices[v2Idx * 3 + 2],
        vertices[v3Idx * 3 + 0],
        vertices[v3Idx * 3 + 1],
        vertices[v3Idx * 3 + 2],
        curNormal
      )

      normals.push(
        curNormal[0],
        curNormal[1],
        curNormal[2],
        curNormal[0],
        curNormal[1],
        curNormal[2],
        curNormal[0],
        curNormal[1],
        curNormal[2]
      )
    }
  }

  console.log('maxBuildingHeight:', Math.max(...buildingIdxToHeight))
  console.log('minBuildingHeight:', Math.min(...buildingIdxToHeight))

  return {
    positions,
    normals,
    buildings,
    barys,
    buildingBinToIdxMap,
    buildingIdxToBinMap,
    buildingIdxToHeight,
    buildingIdxToWidth,
    buildingIdxToMinX,
    buildingIdxToMinZ
  }

  function checkVertex(x, y, z) {
    if (x < 0 || y < 0 || z < 0) {
      console.log(
        `Something wrong with this vertex: ${x}, ${y}, ${z} - building ${buildingCount}`
      )
      return false
    }
    return true
  }
}
