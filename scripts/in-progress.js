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

process.stdin.pipe(split(BUILDING_DELIMITER)).on('data', (building) => {
  const bytes = new Uint8Array(building)
  if (bytes.buffer.byteLength % 36 !== 0) {
    throw new Error('Error! Expected a byteLength divisible by 36')
    process.exit(1)
  }
  processBuilding(new Float32Array(bytes.buffer))
}).on('end', () => {
  console.log('mins', mins)
  console.log('maxs', maxs)
  console.log('granularity', granularity)
  process.exit(0)
})

let maxs = [-Infinity, -Infinity, -Infinity]
let mins = [Infinity, Infinity, Infinity]
let granularity = [Infinity, Infinity, Infinity]

let buildingCount = 0
function processBuilding(tris) {
  for (let i = 0; i < tris.length; i += 3) {
    if (i === 0) {
      continue
    }

    const xDiff = tris[i] - tris[i - 3]
    const yDiff = tris[i + 1] - tris[i - 2]
    const zDiff = tris[i + 2] - tris[i - 1]

    mins[0] = Math.min(mins[0], xDiff)
    mins[1] = Math.min(mins[1], yDiff)
    mins[2] = Math.min(mins[2], zDiff)

    maxs[0] = Math.max(maxs[0], xDiff)
    maxs[1] = Math.max(maxs[1], yDiff)
    maxs[2] = Math.max(maxs[2], zDiff)

    granularity[0] = Math.abs(xDiff) > 0 ? Math.min(granularity[0], Math.abs(xDiff)) : granularity[0]
    granularity[1] = Math.abs(yDiff) > 0 ? Math.min(granularity[1], Math.abs(yDiff)) : granularity[1]
    granularity[2] = Math.abs(zDiff) > 0 ? Math.min(granularity[2], Math.abs(zDiff)) : granularity[2]
  }

  buildingCount += 1
}
