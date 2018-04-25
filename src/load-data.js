const localForage = require('localforage')
const createDataMunger = require('./munge-data')

window.localForage = localForage

module.exports = function loadData(regl, settings, { onDone, onStart }) {
  tryLoadingFromCache()
    .then((data) => {
      console.log('Data loaded from cache!')
      onStart(() => data)
      window.requestIdleCallback(() => onDone(data))
    }).catch((err) => {
      console.log('Cache loading error:', err)
      localForage.clear().then(() => {
        console.log('Cache cleared')
        startFetch()
      })
    })

  function tryLoadingFromCache() {
    if (document.location.hash === '#nocache') {
      if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'cache', 'skip')
      return Promise.reject(new Error('skipping cached data'))
    }
    const keys = ['positions', 'barys', 'buildings', 'randoms', 'buildingIdxToMetadataList', 'DATA_VERSION']
    return Promise.all(keys.map(k => localForage.getItem(k)))
      .then((results) => {
        const emptyResults = results.filter(v => !v || !v.length)
        if (emptyResults.length) {
          if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'cache', 'miss')
          throw new Error('data not found in cache')
        }
        const [positions, barys, buildings, randoms, buildingIdxToMetadataList, DATA_VERSION] = results
        if (window.DATA_VERSION !== DATA_VERSION) {
          if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'cache', 'expired')
          throw new Error('expired version of data found in cache')
        }
        if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'cache', 'hit')
        return { positions, barys, buildings, randoms, buildingIdxToMetadataList, verticesProcessed: positions.length / 3 }
      })
  }

  function startFetch() {
    const metadataFetch = window.fetch(prefixURL('manhattan.pluto.filtered.csv'))
      .then(res => res.text())
      .then(parseMetadataCSV)

    const binToBBLMapFetch = window.fetch(prefixURL('bin-to-bbl.csv'))
      .then(res => res.text())
      .then(parseBinToBBLMapCSV)

    const mungeData = createDataMunger(settings, {
      onStart: onStart,
      onDone: function onDoneWrapper(data) {
        localForage.setItem('positions', data.positions)
        localForage.setItem('barys', data.barys)
        localForage.setItem('buildings', data.buildings)
        localForage.setItem('randoms', data.randoms)
        localForage.setItem('buildingIdxToMetadataList', data.buildingIdxToMetadataList)
        localForage.setItem('DATA_VERSION', window.DATA_VERSION)
        onDone(data)
      }
    })

    Promise.all([metadataFetch, binToBBLMapFetch])
      .then(([metadata, binToBBLMap]) => {
        const geometryFetch = window.fetch(prefixURL('manhattan.indexed.building.triangles.binary'))
        return Promise.all([
          geometryFetch,
          Promise.resolve(metadata),
          Promise.resolve(binToBBLMap)
        ])
      }).then(mungeData)
  }

  function prefixURL(url) {
    return window.IS_DEV ? `models/${url}` : `${settings.objectStorageURL}${url}`
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
