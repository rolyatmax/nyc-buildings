const path = require('path')
const argv = require('minimist')(process.argv.slice(2))
const parseString = require('xml2js').parseString
const readline = require('readline')

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

let currentCityObjectMember = ''
let currentCityObjs = 0

rl.on('line', function(line) {
  if (
    line.includes('<core:cityObjectMember>') ||
    line.includes('<cityObjectMember>') ||
    currentCityObjectMember.length
  ) {
    currentCityObjectMember += line
  }
  if (
    line.includes('</core:cityObjectMember>') ||
    line.includes('</cityObjectMember>')
  ) {
    currentCityObjs += 1
    handleCurrentCityObjectMember(currentCityObjectMember, currentCityObjs)
    currentCityObjectMember = ''
  }
})

let surfaceCount = 0
let positionsCount = 0
function handleCurrentCityObjectMember(xmlString, i) {
  parseString(xmlString, (err, result) => {
    if (err) throw new Error(err)
    const surfaces =
      result['core:cityObjectMember']['bldg:Building'][0]['bldg:boundedBy']
    surfaceCount += surfaces.length
    surfaces.forEach((boundedBy, j) => {
      const surface =
        boundedBy['bldg:GroundSurface'] ||
        boundedBy['bldg:RoofSurface'] ||
        boundedBy['bldg:WallSurface']

      // still need to prove that gml:MultiSurface is the only key in lod2MultiSurface
      // and that it has length=1 and that its only key is gml:surfacemember which always
      // has length=1 which has gml:Polygon as its only key with length=1 which has
      // gml:exterior as its only key at length=1

      // already proved: only LinearRings - each with posList
      const positions = surface[0]['bldg:lod2MultiSurface'][0]['gml:MultiSurface'][0]['gml:surfaceMember'][0]['gml:Polygon'][0]['gml:exterior'][0]['gml:LinearRing'][0]['gml:posList'][0].split(' ')
      positionsCount += positions.length / 3 - 1
    })
    console.log(
      `Processed ${i} cityObjectMembers with ${surfaceCount} total surfaces with ${positionsCount} positions`
    )
  })
}

rl.on('close', () => {
  console.log(`${currentCityObjs} building(s) processed!`)
})
