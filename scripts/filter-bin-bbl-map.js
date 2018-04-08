const path = require('path')
const fs = require('fs')
const argv = require('minimist')(process.argv.slice(2))

if (argv.h || argv.help) {
  console.log(
    `Usage: cat FILENAME | ${process.argv0} ${path.basename(process.argv[1])}`
  )
  process.exit(0)
}

const file = fs.readFileSync(path.join(__dirname, '../models/uniquebblbin.csv'), 'utf8')
const lines = file.split('\r\n')
process.stdout.write(lines[0].split(',').reverse().join(',') + '\r\n')
lines.slice(1).forEach((line, i) => {
  const bits = line.split(',')
  if (bits.length < 2) return
  if (bits[1][0] !== '1') return
  // if (bits.length !== 2) console.log(i, ':', bits[1])
  bits[0] = bits[0].replace(/"/g, '')
  process.stdout.write(bits.reverse().join(',') + '\r\n')
})
