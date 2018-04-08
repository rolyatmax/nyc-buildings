// takes a GML file with <core:cityObjectMember> tags for each building
// and with some number of <gml:posList> surfaces contained within
// and outputs sequential triangles - each made up of 3 sequential
// points, each point made up of 3 sequential values - an x, y, and z,
// each of which is a 32bit Float.
// Each building's triangles are separated by a 4-byte delimiter: ff ff ff ff

const path = require('path')
// const fs = require('fs')
const argv = require('minimist')(process.argv.slice(2))
const readline = require('readline')
const earcut = require('earcut')

const WRITE_TO_STDOUT = false

if (argv.h || argv.help) {
  console.log(
    `Usage: cat FILENAME | ${process.argv0} ${path.basename(process.argv[1])}`
  )
  process.exit(0)
}

// load bin-to-bbl map
// const binToBBLMap = {}
// const file = fs.readFileSync(path.join(__dirname, '../models/uniquebblbin.csv'), 'utf8')
// file.split('\r\n').slice(1).forEach(line => {
//   const bits = line.split(',')
//   binToBBLMap[bits[1]] = bits[0].replace(/"/g, '')
// })

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

const BUILDING_DELIMITER = Buffer.from(Uint8Array.from([255, 255, 255, 255]))
const VERTEX_LIST_DELIMITER = Buffer.from(Uint8Array.from([254, 255, 255, 255]))

let binDoesntStartWith1 = 0
let buildingCount = 0
// either cityObjectMember or core:cityObjectMember
rl.on('line', createFinder('core:cityObjectMember', function(xmlString) {
  buildingCount += 1
  let vertexCount = 0
  const vertices = []
  const vertexMap = {}
  const triangles = []

  // get building's BIN
  const binTagName = '<gen:stringAttribute name="BIN">'
  const cutAt = xmlString.indexOf(binTagName) + binTagName.length
  let binTag = xmlString.slice(cutAt)
  binTag = binTag.slice(binTag.indexOf('<gen:value>') + '<gen:value>'.length)
  const bin = binTag.slice(0, binTag.indexOf('</gen:value>'))
  // skip non-Manhattan (all Manhattan BINs start with "1")
  if (bin[0] !== '1') {
    // if (!WRITE_TO_STDOUT) console.log('BIN doesn\'t start with "1":', binDoesntStartWith1++, bin)
    return
  }

  // const bbl = parseInt(binToBBLMap[bin] || 0, 10)

  const findPosList = createFinder('gml:posList', handlePositionsTag)
  xmlString.split('\n').forEach(bit => {
    findPosList(bit + '\n')
  })

  if (bin === '1087485') {
    console.log('FOUND!!!')
    console.log('vertices:', vertices.length)
    console.log('triangles:', triangles.length)
  }

  writeBuildingData(vertices, triangles, parseInt(bin, 10))

  function handlePositionsTag(xStr) {
    const nums = xStr.replace('<gml:posList>', '').replace('</gml:posList>', '').replace('\n', ' ').trim()
    const p = nums.split(' ').filter(str => str).map(num => parseFloat(num))

    // chop off the last three positions since they are copies of the first position
    p.length = p.length - 3

    // create index of vertices
    for (let k = 0; k < p.length; k += 3) {
      const name = getVertexName(p[k], p[k + 1], p[k + 2])
      if (!vertexMap[name]) {
        vertexMap[name] = vertexCount
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
      ptIndices = earcut(p, null, 3)
    }

    for (let idx of ptIndices) {
      const x = p[idx * 3]
      const y = p[idx * 3 + 1]
      const z = p[idx * 3 + 2]
      const name = getVertexName(x, y, z)
      if (!checkVertex(x, y, z, buildingCount)) {
        throw new Error('SOMETHING WRONG WITH THIS VERTEXXXX')
      }
      if (!Number.isFinite(vertexMap[name])) {
        console.log('UH OH! vertexMap[name] aint what you think it is!')
        console.log('building :', buildingCount)
        console.log('vertexMap[name] :', vertexMap[name])
        console.log('name :', name)
        console.log('vertexMap :', vertexMap)
        throw new Error('Something is wrong!')
      }
      triangles.push(vertexMap[name])
    }
  }
}))

// expected range with the city's DA_WISE dataset
function checkVertex(x, y, z, buildingCount) {
  if (x < 978970 || y < 194470 || z < -40) {
    console.log(`Something wrong with this vertex: ${x}, ${y}, ${z} - building ${buildingCount}`)
    return false
  }
  return true
}

// let buildingsWithFewerThan255Verts = 0
// let buildingsWithMoreThan255Verts = 0
let noBuildingID = 0
function writeBuildingData(vertices, triangles, buildingID) {
  // if (vertices.length / 3 > 255) {
  //   buildingsWithMoreThan255Verts += 1
  // } else {
  //   buildingsWithFewerThan255Verts += 1
  // }
  // console.log(buildingsWithFewerThan255Verts, buildingsWithMoreThan255Verts)

  // if (!buildingID && !WRITE_TO_STDOUT) console.log('no building id:', noBuildingID++)

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
    checkVertex(vertsArray[v], vertsArray[v + 1], vertsArray[v + 2], '?')
  }

  if (WRITE_TO_STDOUT) {
    process.stdout.write(Buffer.from((new Uint32Array([buildingID])).buffer))
    process.stdout.write(Buffer.from(vertsArray.buffer))
    process.stdout.write(VERTEX_LIST_DELIMITER)
    // NOTE: LESS THAN 1% OF BUILDINGS REQUIRE Uint16Array FOR INDEXES
    // THE REST CAN USE Uint8Array!
    let TypedArray = Uint8Array
    if (maxTriangleIdx < 256) {
      TypedArray = Uint8Array
      process.stdout.write(Buffer.from(Uint8Array.from([0])))
    } else {
      TypedArray = Uint16Array
      process.stdout.write(Buffer.from(Uint8Array.from([1])))
    }
    const trisArray = new TypedArray(triangles)
    process.stdout.write(Buffer.from(trisArray.buffer))
    process.stdout.write(BUILDING_DELIMITER)
  }
}

function getVertexName(x, y, z) {
  return `${x}|${y}|${z}`
}

function createFinder (tag, handler) {
  let current = ''
  let count = 0
  return function(line) {
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

// DA12 <-- 1582 / 24038 (6-sided buildings - possible cuboids)
// DA13 <-- 1576 / 23777 (6-sided buildings - possible cuboids)
