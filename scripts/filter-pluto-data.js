const path = require('path')
const fs = require('fs')
const argv = require('minimist')(process.argv.slice(2))

if (argv.h || argv.help) {
  console.log(
    `Usage: cat FILENAME | ${process.argv0} ${path.basename(process.argv[1])}`
  )
  process.exit(0)
}

const columnsToKeep = ['ZoneDist1', 'BldgClass', 'YearBuilt', 'BBL', 'APPBBL']

const file = fs.readFileSync(path.join(__dirname, '../models/pluto_csv/MN2017V11.csv'), 'utf8')
const lines = file.split('\r\n')

const header = splitOnCSVComma(lines[0])
const headerMap = {}
header.forEach((name, idx) => { headerMap[name] = idx })

const columnIndexesToKeep = columnsToKeep.map((name) => headerMap[name])

lines.forEach((line) => {
  const cells = splitOnCSVComma(line)
  if (cells.some(val => val)) {
    process.stdout.write(columnIndexesToKeep.map((idx) => cells[idx]).join(',') + '\r\n')
  }
})

// using this to split on commas that are not inside quotes
// gonna use the strategy of splitting on commas that are followed
// by an even number of quotation marks
function splitOnCSVComma(line) {
  const parts = ['']
  let quotationMarksSeen = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quotationMarksSeen += 1
    if (line[i] === ',' && quotationMarksSeen % 2 === 0) {
      parts.push('')
      continue
    }
    parts[parts.length - 1] += line[i]
  }
  return parts
}
