const path = require('path')
const argv = require('minimist')(process.argv.slice(2))
const readline = require('readline')
const earcut = require('earcut')

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

rl.on('line', createFinder('core:cityObjectMember', function handleObjectMember(xmlString) {
  const findPosList = createFinder('gml:posList', handlePositionsTag)

  xmlString.split('\n').forEach(bit => {
    findPosList(bit + '\n')
  })

  function handlePositionsTag(xStr) {
    const nums = xStr.replace('<gml:posList>', '').replace('</gml:posList>', '').replace('\n', ' ').trim()
    const p = nums.split(' ').filter(str => str).map(num => parseFloat(num))

    // chop off the last three positions since they are copies of the first position
    p.length = p.length - 3

    const positions = []
    let ptIndices
    if (p.length === 4 * 3) {
      ptIndices = [0, 1, 2, 0, 2, 3]
    } else {
      ptIndices = earcut(p, null, 3)
    }

    for (let idx of ptIndices) {
      positions.push(
        p[idx * 3],
        p[idx * 3 + 1],
        p[idx * 3 + 2]
      )
    }

    const array = new Float32Array(positions)
    process.stdout.write(Buffer.from(array.buffer))
  }
}))

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
