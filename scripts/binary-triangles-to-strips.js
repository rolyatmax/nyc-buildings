// This script is meant to read in a bunch of triangles from a binary source,
// and return triangle strips using a dumb algorithm i'm trying out

const path = require('path')
const argv = require('minimist')(process.argv.slice(2))
const split = require('binary-split')
// const shuffle = require('array-shuffle')

if (argv.h || argv.help) {
  console.log(
    `Usage: cat FILENAME | ${process.argv0} ${path.basename(process.argv[1])}`
  )
  process.exit(0)
}

const BUILDING_DELIMITER = Buffer.from(Uint8Array.from([1, 2, 3, 4]))
const TRIANGLE_STRIP_DELIMITER = Buffer.from(Uint8Array.from([5, 6, 7, 8]))

process.stdin.pipe(split(BUILDING_DELIMITER)).on('data', (building) => {
  const bytes = new Uint8Array(building)
  if (bytes.buffer.byteLength % 36 !== 0) {
    throw new Error('Error! Expected a byteLength divisible by 36')
    process.exit(1)
  }
  processBuilding(new Float32Array(bytes.buffer))
})

let buildingCount = 0
function processBuilding(tris) {
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
        verticesNameMap[vertexName] = new Float32Array([x, y, z])
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
    // we want to reverse the strip and go in the other direction after we run
    // out of options. this is how we'll keep track of that
    let hasReversedCurStrip = false
    let curTri = triangles.shift()
    while (trianglesVisited[curTri] && triangles.length) {
      curTri = triangles.shift()
    }
    while (true) {
      if (!curTri) {
        if (hasReversedCurStrip) {
          break
        }
        curStrip.reverse()
        curTri = curStrip.pop()
        hasReversedCurStrip = true
      }
      trianglesVisited[curTri] = true
      curStrip.push(curTri) // perhaps just write to a file here?
      const nextTris = trianglesNeighbors[curTri].filter(t => {
        if (trianglesVisited[t]) return false
        const points = t.split(' ')

        // cannot have more than one point in common with the triangle
        // before last
        if (curStrip.length > 1) {
          let ptsInCommon = 0
          const ptsFromTriBeforeLast = curStrip[curStrip.length - 2].split(' ')
          for (let pnt of points) {
            if (ptsFromTriBeforeLast.includes(pnt)) {
              ptsInCommon += 1
            }
          }
          if (ptsInCommon > 1) return false
        }

        // cannot have a point that's been in the last three triangles
        if (curStrip.length > 2) {
          for (let pnt of points) {
            let isInPreviousTriangles = true
            for (let h = 0; h < 3; h++) {
              const otherTriPts = curStrip[curStrip.length - 1 - h].split(' ')
              if (!otherTriPts.includes(pnt)) {
                isInPreviousTriangles = false
              }
            }
            if (isInPreviousTriangles) return false
          }
        }
        return true
      })
      curTri = nextTris[0]
    }
    curStripIdx += 1
  }

  const collapsedStrips = strips.map(collapseStrip)

  // go through and print out collapsedStrips
  // don't prepend the building delimiter on the first building
  collapsedStrips.forEach((verts, i) => {
    // don't prepend the delimiter on the first strip
    if (i !== 0) process.stdout.write(TRIANGLE_STRIP_DELIMITER)
    verts.forEach(v => {
      const pt = verticesNameMap[v]
      if (!pt) {
        console.log('ERROR!')
        console.log('---- verticesNameMap[v]', verticesNameMap[v])
        console.log('------ v', v)
        console.log('----------- verts:', verts)
        console.log('------------------------ collapsedStrips:', collapsedStrips)
        throw new Error('Something went wrong! - vertex not found in verticesNameMap!')
      }
      process.stdout.write(Buffer.from(pt.buffer))
    })
  })
  process.stdout.write(BUILDING_DELIMITER)
  buildingCount += 1
}

// takes a list of triangleNames
// returns a list of vertexNames
function collapseStrip(strip, idx) {
  strip = strip.map(triName => triName.split(' '))
  if (strip.length === 1) {
    return strip[0]
  }

  let collapsed = []

  if (strip.length === 2) {
    collapsed = strip[0].slice()
    for (let k = 0; k < 3; k++) {
      if (!strip[1].includes(strip[0][k])) {
        const pt = collapsed.splice(k, 1)[0]
        collapsed.unshift(pt)
        break
      }
    }
  } else {
    // for the first triangle, we want to push the three points on in the right order
    for (let k = 0; k < 3; k++) {
      if (strip[1].includes(strip[0][k]) && strip[2].includes(strip[0][k])) {
        collapsed[2] = strip[0][k]
      } else if (strip[1].includes(strip[0][k])) {
        collapsed[1] = strip[0][k]
      } else {
        collapsed[0] = strip[0][k]
      }
    }
  }

  // just make sure we got the first triangle set up correctly
  // (these are all vertexNames at this point - strings)
  if (!collapsed[0] || !collapsed[1] || !collapsed[2]) {
    console.log('ERROR on strip #:', idx)
    console.log('collapsed:', collapsed)
    console.log('triangle:', strip)
    throw new Error('something is wrong: first triangle not correctly formed')
  }

  // now go through all the rest of the triangles pushing the one vertex that's not already
  // in the collapsed list into the collapsed list
  for (let i = 1; i < strip.length; i++) {
    let pointToAdd
    for (let j = 0; j < 3; j++) {
      if (collapsed[collapsed.length - 1] !== strip[i][j] && collapsed[collapsed.length - 2] !== strip[i][j]) {
        if (pointToAdd) {
          console.log('ERROR on strip #:', idx)
          console.log('collapsed:', collapsed)
          console.log('triangle:', strip[i])
          throw new Error('something is wrong: more than one point to add to `collapsed`')
        }
        pointToAdd = strip[i][j]
      }
    }
    if (!pointToAdd) {
      throw new Error('something is wrong: no pointToAdd - degenerate triangle?')
    }
    collapsed.push(pointToAdd)
  }

  return collapsed
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
