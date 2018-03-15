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

let currentCityObjectMember = ''
let currentCityObjs = 0

rl.on('line', function(line) {
  if (line.includes('<core:cityObjectMember>') || line.includes('<cityObjectMember>') || currentCityObjectMember.length) {
    currentCityObjectMember += line
  }
  if (line.includes('</core:cityObjectMember>') || line.includes('</cityObjectMember>')) {
    currentCityObjs += 1
    currentCityObjectMember = ''
  }
})

rl.on('close', () => {
  console.log(`${currentCityObjs} buildings counted!`)
})
