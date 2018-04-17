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

// {center: "10.342331412013948, 20.909690961642347, 0.5", eye: "37.031628438063215, 8.32822156988564, -0.027675636851704377"}
// {center: "7.234034555746952, 18.995379713976504, 0.1", eye: "12.574851384161036, -1.1428760197535723, 11.304425730963771"}

const center = [31.16195, 5.72337, 0] // [0, 0, 10] // [12.574, -1.142, 11.304]
const eye = [6.6518, 16.32714, 0] // [4, 8, 0] // [7.234, 18.995, 0.1]
const camera = createRoamingCamera(canvas, center, eye, getProjection)

window.addEventListener('keypress', (e) => {
  if (e.charCode === 32) {
    console.log({
      center: camera.getCenter().map(v => parseFloat(v)).join(', '),
      eye: camera.getEye().map(v => parseFloat(v)).join(', ')
    })
  }
})

const settings = {
  wireframeThickness: 0.02,
  opacity: 0.65,
  animationSpeed: 0.1,
  animationSpread: 3000,
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

const renderFxaa = createFxaaRenderer(regl)
loadData(regl, settings)
  .onDone(({ positions, barys, randoms, buildings, buildingIdxToMetadataList }) => {
    stateTransitioner = createStateTransitioner(regl, buildingIdxToMetadataList, settings)
    const buildingIdxToStateIndexes = stateTransitioner.getStateIndexes()
    const stateIndexes = new Float32Array(positions.length / 3 * 2)
    let k = 0
    for (let i = 0; i < positions.length / 3; i++) {
      const stateIdx = buildingIdxToStateIndexes[buildings[i]]
      stateIndexes[k++] = stateIdx[0]
      stateIndexes[k++] = stateIdx[1]
    }
    updateBufferIfNeeded(positionsBuffer, positions)
    updateBufferIfNeeded(barysBuffer, barys)
    updateBufferIfNeeded(randomsBuffer, randoms)
    updateBufferIfNeeded(stateIndexesBuffer, stateIndexes)
    globalStateRender = regl({
      uniforms: {
        projection: getProjection,
        view: () => camera.getMatrix(),
        buildingState: stateTransitioner.getStateTexture
      }
    })
    renderBuildings = createBuildingsRenderer(regl, positionsBuffer, barysBuffer, randomsBuffer, stateIndexesBuffer, settings)
    loaded = true
  })

  .onStart((getLatest) => {
    globalStateRender = regl({
      uniforms: {
        projection: getProjection,
        view: () => camera.getMatrix()
      }
    })

    const renderLoader = createLoaderRenderer(regl, positionsBuffer, barysBuffer, randomsBuffer, settings)

    regl.frame((context) => {
      camera.tick()

      if (loaded) {
        stateTransitioner.tick(context, settings)
      } else if (context.tick % 8 === 0) {
        const { positions, barys, randoms } = getLatest()
        updateBufferIfNeeded(positionsBuffer, positions)
        updateBufferIfNeeded(barysBuffer, barys)
        updateBufferIfNeeded(randomsBuffer, randoms)
      }

      renderFxaa(context, () => {
        regl.clear({
          color: [1, 1, 1, 1], // [0.18, 0.18, 0.18, 1],
          depth: 1
        })
        globalStateRender(renderBuildings || renderLoader)
      })
    })
  })

function updateBufferIfNeeded(reglBuffer, dataArray) {
  if (reglBuffer._buffer.byteLength / 4 !== dataArray.length) {
    reglBuffer({ data: new Float32Array(dataArray) })
  }
}
