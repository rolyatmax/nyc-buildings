const path = require('path')
const argv = require('minimist')(process.argv.slice(2))
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

let currentPositions = ''
let positionsCount = 0

rl.on('line', function(line) {
  if (
    line.includes('<gml:posList>') ||
    currentPositions.length
  ) {
    currentPositions += line
  }
  if (
    line.includes('</gml:posList>')
  ) {
    positionsCount += 1
    handlePositionsTag(currentPositions, positionsCount)
    currentPositions = ''
  }
})

let duplicates = {}
// let dupCount = 0
// let totalCount = 0

const positions = []
function handlePositionsTag(xmlString, i) {
  xmlString = xmlString.replace('<gml:posList>', '')
  xmlString = xmlString.replace('</gml:posList>', '')
  xmlString = xmlString.trim()
  const p = xmlString.split(' ')

  // chop off the last three positions since they are copies of the first position
  p.length = p.length - 3
  for (let j = 0; j < p.length; j += 3) {
    // totalCount += 1
    const key = `${p[j]}|${p[j + 1]}|${p[j + 2]}`
    if (duplicates[key]) {
      duplicates[key] += 1
      // dupCount += 1
      continue
    }
    positions.push(p[j], p[j + 1], p[j + 2])
    duplicates[key] = 1
  }
}

rl.on('close', () => {
  // console.log(`${dupCount} dupes out of ${totalCount} positions`)
  // console.log(`Deduping will save ${dupCount * 12 / 1000000}MB or ${(dupCount / totalCount) * 100}%`)
  const array = new Float32Array(positions)
  process.stdout.write(Buffer.from(array.buffer))
})
