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

rl.on('line', createFinder('cityObjectMember', function(xmlString) {
  if (isInManhattan(xmlString)) {
    process.stdout.write(xmlString + '\n')
  }
}))

const searchPhrase = '_Borough_Block_Lot_number_'
function isInManhattan(xml) {
  const i = xml.indexOf(searchPhrase)
  return xml[i + searchPhrase.length] === '1'
}

function createFinder (tag, handler) {
  let current = ''
  let count = 0
  return function(line) {
    if (line.includes(`<${tag}`)) {
      const k = line.indexOf(`<${tag}`)
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
