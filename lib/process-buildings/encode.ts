// ----------------------------------------------------

//       NOTE: THIS FILE IS NOT FUNCTIONAL
//             * ONLY FOR REFERENCE *

// ----------------------------------------------------
// takes a GML file with <core:cityObjectMember> tags for each building
// and with some number of <gml:posList> surfaces contained within
// and outputs vertices for each building, plus triangles - each made up of 3
// points which are indexes into the vertices list

/*

output data format:

------- HEADER ------
(generate this after the fact, so you can cat a bunch of building files together and then generate a header at the end)
triangleCount - uint32
buildingCount - uint32
--------------
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
repeat with next building

*/

import * as path from 'path'
import * as readline from 'readline'
import earcut from 'earcut'
import minimist from 'minimist'

const argv = minimist(process.argv.slice(2))

const WRITE_TO_STDOUT = false

if (argv.h || argv.help) {
  console.log(
    `Usage: cat FILENAME | ${process.argv0} ${path.basename(process.argv[1])}`
  )
  process.exit(0)
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

let buildingCount = 0
// either cityObjectMember or core:cityObjectMember
rl.on('line', createFinder('core:cityObjectMember', function (xmlString) {
  buildingCount += 1
  let vertexCount = 0
  const vertices: number[] = []
  const vertexMap = new Map<string, number>()
  const triangles: number[] = []

  // get building's BIN
  const binTagName = '<gen:stringAttribute name="BIN">'
  const cutAt = xmlString.indexOf(binTagName) + binTagName.length
  let binTag = xmlString.slice(cutAt)
  binTag = binTag.slice(binTag.indexOf('<gen:value>') + '<gen:value>'.length)
  const bin = binTag.slice(0, binTag.indexOf('</gen:value>'))

  const findPosList = createFinder('gml:posList', handlePositionsTag)
  xmlString.split('\n').forEach(bit => {
    findPosList(bit + '\n')
  })

  writeBuildingData(vertices, triangles, parseInt(bin, 10))

  function handlePositionsTag (xStr: string): void {
    const nums = xStr.replace('<gml:posList>', '').replace('</gml:posList>', '').replace('\n', ' ').trim()
    const p = nums.split(' ').filter(str => str).map(num => parseFloat(num))

    // chop off the last three positions since they are copies of the first position
    p.length = p.length - 3

    // create index of vertices
    for (let k = 0; k < p.length; k += 3) {
      const name = getVertexName(p[k], p[k + 1], p[k + 2])
      if (!vertexMap.has(name)) {
        vertexMap.set(name, vertexCount)
        vertices.push(p[k], p[k + 1], p[k + 2])
        if (!checkVertex(p[k], p[k + 1], p[k + 2], buildingCount)) {
          throw new Error('SOMETHING WRONG WITH THIS VERTEXXXX')
        }
        vertexCount += 1
      }
    }

    let ptIndices
    if (p.length === 4 * 3) {
      ptIndices = [0, 1, 2, 0, 2, 3]
    } else {
      ptIndices = earcut(p, undefined, 3)
    }

    for (const idx of ptIndices) {
      const x = p[idx * 3]
      const y = p[idx * 3 + 1]
      const z = p[idx * 3 + 2]
      const name = getVertexName(x, y, z)
      if (!checkVertex(x, y, z, buildingCount)) {
        throw new Error('SOMETHING WRONG WITH THIS VERTEXXXX')
      }
      const vertexIdx = vertexMap.get(name)
      if (!vertexIdx) {
        console.log('UH OH! vertexMap.get(name) aint what you think it is!')
        console.log('building :', buildingCount)
        console.log('vertexMap.get(name) :', vertexIdx)
        console.log('name :', name)
        console.log('vertexMap :', vertexMap)
        throw new Error('Something is wrong!')
      }
      triangles.push(vertexIdx)
    }
  }
}))

// expected range with the city's DA_WISE dataset
function checkVertex (x: number, y: number, z: number, buildingCount: number): boolean {
  if (x < 978970 || y < 194470 || z < -40) {
    console.log(`Something wrong with this vertex: ${x}, ${y}, ${z} - building ${buildingCount}`)
    return false
  }
  return true
}

function writeBuildingData (vertices: number[], triangles: number[], buildingID: number): void {
  const maxTriangleIdx = Math.max(...triangles)
  if (maxTriangleIdx + 1 !== vertices.length / 3) {
    console.log('ERROR')
    console.log('mismatch between vertices and maxTriangleIdx')
    console.log('vertices.length', vertices.length)
    console.log('maxTriangleIdx', maxTriangleIdx)
    throw new Error('Something is wrong!')
  }

  const vertsArray = new Float32Array(vertices)
  for (let v = 0; v < vertsArray.length; v += 3) {
    checkVertex(vertsArray[v], vertsArray[v + 1], vertsArray[v + 2], -1)
  }

  if (WRITE_TO_STDOUT) {
    // buildingId
    process.stdout.write(Buffer.from((new Uint32Array([buildingID])).buffer))
    // vertexCount
    process.stdout.write(Buffer.from((new Uint32Array([vertsArray.length / 3])).buffer))
    // all the vertices
    process.stdout.write(Buffer.from(vertsArray.buffer))
    // triangle count
    process.stdout.write(Buffer.from((new Uint32Array([triangles.length / 3])).buffer))
    // NOTE: LESS THAN 1% OF BUILDINGS REQUIRE Uint16Array FOR INDEXES
    // THE REST CAN USE Uint8Array!
    const TypedArray = maxTriangleIdx < 256 ? Uint8Array : Uint16Array
    const trisArray = new TypedArray(triangles)
    // all the triangle indices (as either uint8 or uint16)
    process.stdout.write(Buffer.from(trisArray.buffer))
  }
}

function getVertexName (x: number, y: number, z: number): string {
  return `${x}|${y}|${z}`
}

function createFinder (
  tag: string,
  handler: (cur: string, count: number) => void
): (line: string) => void {
  let current = ''
  let count = 0
  return function (line) {
    if (line.includes(`<${tag}>`)) {
      const k = line.indexOf(`<${tag}>`)
      current += line.slice(k) + '\n'
    } else if (current.length) {
      current += line + '\n'
    }
    const closingTag = `</${tag}>`
    if (line.includes(closingTag)) {
      const k = current.indexOf(closingTag) + closingTag.length
      current = current.slice(0, k)
      count += 1
      handler(current, count)
      current = ''
    }
  }
}
