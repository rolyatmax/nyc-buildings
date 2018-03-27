// This script is meant to read in a bunch of triangles from a binary source,
// and return triangle strips using a dumb algorithm i'm trying out

// TODO: Current problem:
// The script slows down way too much when processing all of Manhattan at the same time
// It needs to operate on a stream, doing the following for each building:
// 1. Write all vertex data in binary output to a file (not including
//    previously-used vertices from entire dataset)
// 2. After receiving all vertices for a building, run the triangle strip
//    algorithm and write the output to another file with building & triangle
//    strip delimiters - the triangle strips should be lists of indexes into
//    the vertex data file

const path = require('path')
const argv = require('minimist')(process.argv.slice(2))
const shuffle = require('array-shuffle')

if (argv.h || argv.help) {
  console.log(
    `Usage: cat FILENAME | ${process.argv0} ${path.basename(process.argv[1])}`
  )
  process.exit(0)
}

let input = []
process.stdin.on('data', (data) => { input.push(data) })
process.stdin.on('close', () => {
  let len = 0
  input.forEach(buf => { len += buf.byteLength })
  const bytes = new Uint8Array(len)
  let i = 0
  input.forEach(buf => {
    const tmp = new Uint8Array(buf)
    for (let b = 0; b < tmp.length; b++) {
      bytes[i++] = tmp[b]
    }
  })
  processTriangles(new Float32Array(bytes.buffer))
})

// should be used to process triangles for a single building
function processTriangles(tris) {
  const vertices = []
  const verticesNameMap = {}
  let triangles = []
  const trianglesNameMap = {}
  const trianglesVisited = {}
  const trianglesByEdge = {}
  const trianglesNeighbors = {}
  let k = 0
  for (let i = 0; i < tris.length; i += 9) {
    for (let j = 0; j < 3; j++) {
      const x = tris[i + j * 3 + 0]
      const y = tris[i + j * 3 + 1]
      const z = tris[i + j * 3 + 2]
      const vertexName = getVertexName(x, y, z)
      if (!verticesNameMap[vertexName]) {
        vertices.push(x, y, z) // perhaps just write this to a file at this point
        verticesNameMap[vertexName] = k++
      }
    }
    const a = tris.slice(i + 0, i + 3)
    const b = tris.slice(i + 3, i + 6)
    const c = tris.slice(i + 6, i + 9)
    const triangleName = getTriangleName(a, b, c)
    trianglesNeighbors[triangleName] = trianglesNeighbors[triangleName] || []
    const edges = [[a, b], [b, c], [a, c]]
    edges.forEach((edge) => {
      const edgeName = getEdgeName(edge[0], edge[1])
      trianglesByEdge[edgeName] = trianglesByEdge[edgeName] || []
      trianglesByEdge[edgeName].forEach(tName => {
        if (tName !== triangleName) {
          trianglesNeighbors[triangleName].push(tName)
          trianglesNeighbors[tName].push(triangleName)
        }
      })
      trianglesByEdge[edgeName].push(triangleName)
    })
    trianglesNameMap[triangleName] = [a, b, c]
    trianglesVisited[triangleName] = false
    triangles.push(triangleName)
  }

  // perhaps add the ability to run a couple times and select the best result
  // triangles = shuffle(triangles) // turning off for now because adds non-determinism

  const strips = []
  let curStripIdx = 0
  while (triangles.length) {
    const curStrip = strips[curStripIdx] = strips[curStripIdx] || []
    let curTri = triangles.shift()
    while (trianglesVisited[curTri] && triangles.length) {
      curTri = triangles.shift()
    }
    while (curTri) {
      trianglesVisited[curTri] = true
      curStrip.push(curTri) // perhaps just write to a file here?
      const nextTris = trianglesNeighbors[curTri].filter(t => !trianglesVisited[t])
      curTri = nextTris[0]
    }
    curStripIdx += 1 // perhaps just write strip delimiter to a file here?
  }
  // perhaps just write building delimiter to a file here?
  console.log('strip count', strips.length)
  console.log('triangle count', tris.length / 9)
}

function getEdgeName(a, b) {
  const aName = getVertexName(a[0], a[1], a[2])
  const bName = getVertexName(b[0], b[1], b[2])
  return aName < bName ? `${aName} ${bName}` : `${bName} ${aName}`
}

function getTriangleName(a, b, c) {
  // a triangle's name is just its three points' names in alpha
  // order separated by a space
  const aName = getVertexName(a[0], a[1], a[2])
  const bName = getVertexName(b[0], b[1], b[2])
  const cName = getVertexName(c[0], c[1], c[2])
  const parts = [aName, bName, cName]
  parts.sort((a, b) => a < b ? -1 : 1)
  return parts.join(' ')
}

function getVertexName(x, y, z) {
  return `${x}|${y}|${z}`
}
