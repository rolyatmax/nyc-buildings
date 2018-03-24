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

const positions = []
function handlePositionsTag(xmlString, i) {
  xmlString = xmlString.replace('<gml:posList>', '')
  xmlString = xmlString.replace('</gml:posList>', '')
  xmlString = xmlString.trim()
  const p = xmlString.split(' ')

  // chop off the last three positions since they are copies of the first position
  p.length = p.length - 3
  for (let num of p) {
    positions.push(num)
  }
}

rl.on('close', () => {
  const array = new Float32Array(positions)
  process.stdout.write(Buffer.from(array.buffer))
})
