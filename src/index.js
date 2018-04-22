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
const cameraPositions = require('./camera-positions')

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

const center = cameraPositions.onStart.center
const eye = cameraPositions.onStart.eye
const camera = createRoamingCamera(canvas, center, eye, getProjection, cameraPositions.positions)

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
  wireframeThickness: 0.003,
  wireframeDistanceThreshold: 9,
  opacity: 0.65,
  animationSpeed: 0.1,
  animationSpread: 3000,
  loadingAnimationSpeed: 0.005,
  colorCodeField: 'height',
  primitive: 'triangles',
  showFewerBuildings: false
}

const gui = new GUI()
gui.closed = true
gui.add(settings, 'wireframeThickness', 0, 0.1).step(0.001)
gui.add(settings, 'wireframeDistanceThreshold', 1, 20).step(1)
gui.add(settings, 'primitive', ['triangles', 'triangle strip', 'lines', 'line strip', 'points'])
gui.add(settings, 'opacity', 0, 1).step(0.01)
gui.add(settings, 'showFewerBuildings').name('Fewer Buildings')
gui.add({ roam: camera.startRoaming }, 'roam').name('Next Camera Position')

const renderButtons = createButtons(document.querySelector('.button-group'), settings)
renderButtons(settings)

const get32BitSlotCount = (vertexCount) => (
  vertexCount * 3 + // positions
  vertexCount + // randoms
  vertexCount * 2 + // stateIndexes
  vertexCount * 3 // barys
)

const attributesBuffer = regl.buffer({
  usage: 'dynamic',
  type: 'float',
  length: get32BitSlotCount(settings.POSITIONS_LENGTH / 3) * 4
})

const byteStride = get32BitSlotCount(1) * 4
const positionsBuffer = {
  buffer: attributesBuffer,
  offset: 0,
  stride: byteStride
}

const randomsBuffer = {
  buffer: attributesBuffer,
  offset: 3 * 4,
  stride: byteStride
}

const stateIndexesBuffer = {
  buffer: attributesBuffer,
  offset: 4 * 4,
  stride: byteStride
}

const barysBuffer = {
  buffer: attributesBuffer,
  offset: 6 * 4,
  stride: byteStride
}

let globalStateRender, stateTransitioner, renderBuildings
let loaded = false

const loader = createLoaderRenderer(document.querySelector('.loader'))

const renderFxaa = createFxaaRenderer(regl)
loadData(regl, settings, {
  onDone({ positions, barys, randoms, buildings, buildingIdxToMetadataList }) {
    loader.render(1)
    updateLoadingState({ positions, barys, randoms, buildings })
    setTimeout(() => {
      loader.remove()
      camera.updateSpeed(0.005, 0.02)
      camera.moveTo(cameraPositions.onFinishLoad)
      setTimeout(() => {
        document.body.classList.remove('for-intro')
        loaded = true
        window.requestIdleCallback(() => stateTransitioner.setupMetaData(buildingIdxToMetadataList))
        setTimeout(camera.startRoaming, 5000)
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

    setTimeout(() => {
      camera.updateSpeed(0.0015, 0.0015)
      camera.moveTo(cameraPositions.onStartLoad)
    }, 100)

    let curPositionsLoaded = 0

    regl.frame((context) => {
      camera.tick()

      context.isLoading = !loaded

      stateTransitioner.tick(context, settings)

      renderAutopilotButton()

      if (!loaded && context.tick % 5 === 0) {
        const latest = getLatest()
        curPositionsLoaded = latest.positions.length / 3
        stateTransitioner.updateLoadingState(latest.buildingIdxToMetadataList)
        updateLoadingState(latest)
        loader.render(latest.buildingIdxToMetadataList.length / settings.BUILDINGS_COUNT)
      }

      // this 0.495 makes sure Inwood doesn't show up when cutting the buildings count in half
      const countMultiplier = settings.showFewerBuildings ? 0.495 : 1

      renderFxaa(context, () => {
        regl.clear({
          color: [1, 1, 1, 1],
          depth: 1
        })
        globalStateRender(() => {
          renderBuildings({
            primitive: settings.primitive,
            count: (curPositionsLoaded * countMultiplier) | 0
          })
        })
      })
    })
  }
})

const autopilotButton = document.querySelector('.autopilot-button')
autopilotButton.addEventListener('click', () => {
  camera.startRoaming()
})
function renderAutopilotButton() {
  if (camera.isRoaming()) {
    autopilotButton.classList.add('hidden')
  } else {
    autopilotButton.classList.remove('hidden')
  }
}

let lastI = 0
function updateLoadingState({ positions, barys, randoms, buildings }) {
  const buildingIdxToStateIndexes = stateTransitioner.getStateIndexes()
  const stride = get32BitSlotCount(1)
  const newData = new Float32Array((positions.length / 3 - lastI) * stride)
  const subDataOffset = lastI * stride * 4
  let k = 0
  for (let i = lastI; i < positions.length / 3; i++) {
    newData[k++] = positions[i * 3 + 0]
    newData[k++] = positions[i * 3 + 1]
    newData[k++] = positions[i * 3 + 2]
    newData[k++] = randoms[i]
    const stateIdx = buildingIdxToStateIndexes[buildings[i]]
    newData[k++] = stateIdx[0]
    newData[k++] = stateIdx[1]
    newData[k++] = barys[i * 3 + 0]
    newData[k++] = barys[i * 3 + 1]
    newData[k++] = barys[i * 3 + 2]
    lastI = i
  }
  attributesBuffer.subdata(newData, subDataOffset)
}
