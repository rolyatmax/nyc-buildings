const createDataMunger = require('./munge-data')

module.exports = function loadData(regl, settings) {
  let onStart, onDone
  let onStartWrapper = (ctx) => onStart && onStart(ctx)
  let onDoneWrapper = (ctx) => onDone && onDone(ctx)

  const metadataFetch = window.fetch('models/manhattan.pluto.filtered.csv')
    .then(res => res.text())
    .then(parseMetadataCSV)

  const binToBBLMapFetch = window.fetch('models/bin-to-bbl.csv')
    .then(res => res.text())
    .then(parseBinToBBLMapCSV)

  const mungeData = createDataMunger({
    onStart: onStartWrapper,
    onDone: onDoneWrapper
  })

  Promise.all([metadataFetch, binToBBLMapFetch])
    .then(([metadata, binToBBLMap]) => {
      const geometryFetch = window.fetch('models/manhattan.indexed.building.triangles.binary')
      return Promise.all([
        geometryFetch,
        Promise.resolve(metadata),
        Promise.resolve(binToBBLMap)
      ])
    })
    .then(mungeData)

  return {
    onStart(cb) { onStart = cb; return this },
    onDone(cb) { onDone = cb; return this }
  }
}

// NOTE: should probably just do this mapping up front when building the meshes?
function parseBinToBBLMapCSV(csvText) {
  const binToBBLMap = {}
  csvText.split('\r\n').slice(1).forEach(line => {
    const bits = splitOnCSVComma(line)
    binToBBLMap[parseInt(bits[0], 10)] = parseInt(bits[1], 10)
  })
  return binToBBLMap
}

function parseMetadataCSV(csvText) {
  const lines = csvText.split('\r\n')
  const header = splitOnCSVComma(lines[0])
  const headerMap = {}
  header.forEach((name, idx) => { headerMap[name] = idx })
  const bblToMetadataMap = {}
  const bblColIDX = headerMap['BBL']
  const appbblColIDX = headerMap['APPBBL']
  lines.slice(1).forEach(l => {
    const row = splitOnCSVComma(l)
    bblToMetadataMap[row[bblColIDX]] = row
    bblToMetadataMap[row[appbblColIDX]] = row
    return row
  })
  return {
    headerMap,
    bblToMetadataMap
  }
}

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
