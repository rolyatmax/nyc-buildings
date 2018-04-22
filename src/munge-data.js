// const getNormal = require('triangle-normal')

const BUILDING_DELIMITER = [255, 255, 255, 255]
const VERTEX_LIST_DELIMITER = [254, 255, 255, 255]

module.exports = function createDataMunger({ onStart, onUpdate, onDone }) {
  let positions = []
  // let normals = []
  let buildings = []
  let barys = []
  let randoms = []
  let buildingIdxToMetadataList = []

  function getLatest () {
    return { positions, barys, buildings, randoms, buildingIdxToMetadataList }
  }

  return function mungeData([meshRes, metadata, binToBBLMap]) {
    let isFirstChunk = true
    let isLastChunk = false
    if (meshRes.body && meshRes.body.getReader) {
      const reader = meshRes.body.getReader()
      reader.read().then(function processStream({ done, value }) {
        if (isFirstChunk) {
          processChunk(value)
          onStart(getLatest)
          isFirstChunk = false
        } else {
          window.requestIdleCallback(() => {
            if (done) isLastChunk = true
            processChunk(value)
            if (done) {
              window.requestIdleCallback(() => onDone(getLatest()))
            }
          })
        }
        if (!done) return reader.read().then(processStream)
      })
    } else {
      meshRes.arrayBuffer().then((m) => {
        isFirstChunk = isLastChunk = true
        processChunk(new Uint8Array(m))
        onStart(getLatest)
        window.requestIdleCallback(() => onDone(getLatest()))
      })
    }

    let buildingCount = 0
    // let curNormal = [] // reuse this array
    let vertices = [] // reuse this array

    let curVertIdxByteSize = null
    let curBuildingID, sectionStart, p

    let leftoverChunk = []

    const { bblToMetadataMap, headerMap } = metadata

    if (sectionStart !== p) {
      console.log('sectionStart does not equal p!')
      console.log('sectionStart:', sectionStart)
      console.log('p:', p)
      console.log('buildingCount:', buildingCount)
      throw new Error('UGHHHHHH')
    }

    // lengths: {positions: 32895792, buildings: 10965264, barys: 32895792, randoms: 10965264}
    // positions = new Float32Array(positions)
    // normals = new Float32Array(normals)
    // buildings = new Uint32Array(buildings)
    // barys = new Float32Array(barys)
    // randoms = new Float32Array(randoms)

    // ------------------------------------------------
    // ------------ processing functions
    // ------------------------------------------------

    function processChunk(chunk) {
      if (isFirstChunk) {
        curBuildingID = new Uint32Array(chunk.slice(0, 4).buffer)[0]
        sectionStart = 4
        p = 4
      }

      if (!chunk) {
        chunk = leftoverChunk
        leftoverChunk = []
      }

      if (leftoverChunk.length) {
        const newChunk = new Uint8Array(leftoverChunk.length + chunk.length)
        newChunk.set(leftoverChunk)
        newChunk.set(chunk, leftoverChunk.length)
        chunk = newChunk
        leftoverChunk = []
      }

      const stopAt = isLastChunk ? chunk.length : chunk.length - 8

      while (p < stopAt) {
        // if (buildingCount > 30000) break
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
          processBuildingTriangles(chunk, sectionStart, p, curVertIdxByteSize, curBuildingID)
          curVertIdxByteSize = null
          curBuildingID = new Uint32Array(chunk.slice(p + 4, p + 8).buffer)[0]
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

    function processBuildingVertices(buf, sectionStart, sectionEnd) {
      const b = buf.slice(sectionStart, sectionEnd)
      vertices = new Float32Array(b.buffer)
      if (vertices.length % 3 !== 0) {
        throw new Error('ACK! Something is wrong with the vertices!')
      }
    }

    function processBuildingTriangles(
      buf,
      sectionStart,
      sectionEnd,
      vertIdxByteSize,
      buildingID
    ) {
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

      const bbl = binToBBLMap[buildingID]
      const row = bbl && bblToMetadataMap[bbl]
      if (!bbl || !row) {
        buildingIdxToMetadataList.push({ centroid })
      } else {
        buildingIdxToMetadataList.push({
          centroid: centroid,
          built: parseInt(row[headerMap['YearBuilt']], 10),
          zone: row[headerMap['ZoneDist1']],
          class: row[headerMap['BldgClass']],
          height: maxZ - minZ
          // width: maxX - minX,
          // minX: minX,
          // minY: minY,
          // minZ: minZ
        })
      }

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

        randoms.push(buildingEntropyValue, buildingEntropyValue, buildingEntropyValue)

        // getNormal(
        //   vertices[v1Idx * 3 + 0],
        //   vertices[v1Idx * 3 + 1],
        //   vertices[v1Idx * 3 + 2],
        //   vertices[v2Idx * 3 + 0],
        //   vertices[v2Idx * 3 + 1],
        //   vertices[v2Idx * 3 + 2],
        //   vertices[v3Idx * 3 + 0],
        //   vertices[v3Idx * 3 + 1],
        //   vertices[v3Idx * 3 + 2],
        //   curNormal
        // )

        // normals.push(
        //   curNormal[0],
        //   curNormal[1],
        //   curNormal[2],
        //   curNormal[0],
        //   curNormal[1],
        //   curNormal[2],
        //   curNormal[0],
        //   curNormal[1],
        //   curNormal[2]
        // )
      }
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
}
