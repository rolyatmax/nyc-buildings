const createRegl = require('regl')
const fit = require('canvas-fit')
const mat4 = require('gl-mat4')
const { GUI } = require('dat-gui')
const createStateTransitioner = require('./create-state-transitioner')
const createButtons = require('./create-buttons')
const createRoamingCamera = require('./create-roaming-camera')
const createFxaaRenderer = require('./render-fxaa')
const createBuildingsRenderer = require('./render-buildings')
const createLoaderRenderer = require('./render-loader')
const loadData = require('./load-data')

const canvas = document.body.appendChild(document.querySelector('.viz'))
window.addEventListener('resize', fit(canvas), false)
const regl = createRegl({
  extensions: ['oes_standard_derivatives'], // , 'oes_texture_float'],
  canvas: canvas
})

window.regl = regl

const getProjection = () => mat4.perspective(
  [],
  Math.PI / 4,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
)

// Empire close-up: { center: [8.807, 19.479, 0.1], eye: [9.976, 15.771, 1.858] }
// Downtown close-up: { center: [2.134, 3.823, 0.100], eye: [1.615, -2.120, 1.307] }
// Midtown from park: { center: [12.275, 22.259, 0.100], eye: [19.378, 27.368, 6.863] }

const ABOVE = { center: [8.807, 19.479, 0.100], eye: [11.141, 9.103, 45.002] }
const FROM_SIDE = { center: [8.674, 16.334, 0.100], eye: [36.409, 11.720, 0.117] }
const START_FROM_SIDE = { center: [8.674, 16.334, 2.100], eye: [36.409, 11.720, 2.117] }

const center = START_FROM_SIDE.center
const eye = START_FROM_SIDE.eye
const camera = createRoamingCamera(canvas, center, eye, getProjection)

window.moveTo = camera.moveTo

window.addEventListener('keypress', (e) => {
  if (e.charCode === 32) {
    console.log('{',
      'center:', `[${camera.getCenter().map(v => parseFloat(v).toFixed(3)).join(', ')}],`,
      'eye:', `[${camera.getEye().map(v => parseFloat(v).toFixed(3)).join(', ')}]`, '}'
    )
  }
})

const settings = {
  // hardcoding so we can set up stateTransitioner early and show loading progress
  BUILDINGS_COUNT: 45707,
  // hardcoding so we can set up stateIndexes array early
  POSITIONS_LENGTH: 32895792,
  wireframeThickness: 0, // 0.005,
  opacity: 0.65,
  animationSpeed: 0.1,
  animationSpread: 3000,
  loadingAnimationSpeed: 0.005,
  colorCodeField: 'built'
}

const gui = new GUI()
gui.closed = true
gui.add(settings, 'wireframeThickness', 0, 0.35).step(0.001)
gui.add(settings, 'opacity', 0, 1).step(0.01)
gui.add({ roam: camera.startRoaming }, 'roam')

const renderButtons = createButtons(document.querySelector('.button-group'), settings)
renderButtons(settings)

const positionsBuffer = regl.buffer({ usage: 'dynamic' })
const barysBuffer = regl.buffer({ usage: 'dynamic' })
const randomsBuffer = regl.buffer({ usage: 'dynamic' })
const stateIndexesBuffer = regl.buffer({ usage: 'dynamic' })

window.positionsBuffer = positionsBuffer

let globalStateRender, stateTransitioner, renderBuildings
let loaded = false

const loader = createLoaderRenderer(document.querySelector('.loader'))

const renderFxaa = createFxaaRenderer(regl)
loadData(regl, settings, {
  onDone({ positions, barys, randoms, buildings, buildingIdxToMetadataList }) {
    loader.render(1)
    updateLoadingState({ positions, barys, randoms, buildings })
    console.log('final:', buildingIdxToMetadataList.length)
    setTimeout(() => {
      loader.remove()
      camera.moveTo(ABOVE)
      setTimeout(() => {
        document.body.classList.remove('for-intro')
        loaded = true
        window.requestIdleCallback(() => stateTransitioner.setupMetaData(buildingIdxToMetadataList))
      }, 1500)
    }, 200)
  },
  onStart(getLatest) {
    stateTransitioner = createStateTransitioner(regl, settings)
    renderBuildings = createBuildingsRenderer(regl, positionsBuffer, barysBuffer, randomsBuffer, stateIndexesBuffer, settings)

    globalStateRender = regl({
      uniforms: {
        projection: getProjection,
        view: () => camera.getMatrix(),
        buildingState: stateTransitioner.getStateTexture,
        isLoading: () => !loaded
      }
    })

    regl.frame((context) => {
      camera.tick()

      context.isLoading = !loaded

      stateTransitioner.tick(context, settings)

      if (!loaded && context.tick % 16 === 0) {
        const latest = getLatest()
        console.log(latest.buildingIdxToMetadataList.length)
        stateTransitioner.updateLoadingState(latest.buildingIdxToMetadataList)
        updateLoadingState(latest)
        loader.render(latest.buildingIdxToMetadataList.length / settings.BUILDINGS_COUNT)
      }

      renderFxaa(context, () => {
        regl.clear({
          color: [1, 1, 1, 1],
          depth: 1
        })
        globalStateRender(() => {
          renderBuildings({ primitive: loaded ? 'triangles' : 'lines' })
        })
      })
    })
  }
})

function updateBufferIfNeeded(reglBuffer, dataArray) {
  if (reglBuffer._buffer.byteLength / 4 !== dataArray.length) {
    reglBuffer({ data: new Float32Array(dataArray) })
  }
}

function updateLoadingState({ positions, barys, randoms, buildings }) {
  updateStateIndexes({ positions, buildings })
  updateBufferIfNeeded(positionsBuffer, positions)
  updateBufferIfNeeded(barysBuffer, barys)
  updateBufferIfNeeded(randomsBuffer, randoms)
}

let stateIndexes = new Float32Array(settings.POSITIONS_LENGTH / 3 * 2)
let lastK = 0
let lastI = 0
function updateStateIndexes({ positions, buildings }) {
  const buildingIdxToStateIndexes = stateTransitioner.getStateIndexes()
  let k = lastK
  for (let i = lastI; i < positions.length / 3; i++) {
    const stateIdx = buildingIdxToStateIndexes[buildings[i]]
    stateIndexes[k++] = stateIdx[0]
    stateIndexes[k++] = stateIdx[1]
    lastK = k
    lastI = i
  }
  stateIndexesBuffer({ data: stateIndexes })
}
