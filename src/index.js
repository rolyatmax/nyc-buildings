require('ric')
const canvasSketch = require('canvas-sketch')
const createRegl = require('regl')
const mat4 = require('gl-mat4')
const { GUI } = require('dat-gui')
const createStateTransitioner = require('./create-state-transitioner')
const createRoamingCamera = require('./create-roaming-camera')
const createBuildingsRenderer = require('./render-buildings')
const loadData = require('./load-data')
const createBuffers = require('./create-buffers')
const cameraPositions = require('./camera-positions')

const WIDTH = 5550
const HEIGHT = 3750

window.DATA_VERSION = '1.1'
window.IS_DEV = !document.location.origin.includes('tbaldw.in')

function sketch ({ gl, play }) {
  gl.getExtension('oes_standard_derivatives')
  const regl = createRegl({ gl })

  const getProjection = () => mat4.perspective(
    [],
    Math.PI / 4,
    WIDTH / HEIGHT,
    0.01,
    1000
  )

  const camera = createRoamingCamera(
    gl.canvas,
    cameraPositions.onStart.center,
    cameraPositions.onStart.eye,
    getProjection,
    cameraPositions.positions
  )

  const settings = {
    objectStorageURL: 'https://tbaldwin.nyc3.digitaloceanspaces.com/',
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
    primitive: 'triangles'
  }

  const gui = new GUI()
  gui.closed = true
  gui.add(settings, 'wireframeThickness', 0, 0.1).step(0.001)
  gui.add(settings, 'wireframeDistanceThreshold', 1, 20).step(1)
  gui.add(settings, 'primitive', ['triangles', 'triangle strip', 'lines', 'line strip', 'points'])
  gui.add(settings, 'opacity', 0, 1).step(0.01)
  gui.add({ roam: camera.startRoaming }, 'roam').name('Move Camera')

  const buffers = createBuffers(regl, settings)

  let globalStateRender, stateTransitioner, renderBuildings
  let loaded = false

  loadData(regl, settings, {
    onStart() {},
    onDone({ positions, barys, randoms, buildings, buildingIdxToMetadataList, verticesProcessed }) {
      stateTransitioner = createStateTransitioner(regl, settings)
      const attrs = buffers.getAttributes()
      renderBuildings = createBuildingsRenderer(regl, attrs.positions, attrs.barys, attrs.randoms, attrs.stateIndexes, settings)

      globalStateRender = regl({
        uniforms: {
          projection: getProjection,
          view: () => camera.getMatrix(),
          buildingState: stateTransitioner.getStateTexture,
          isLoading: false
        }
      })

      loaded = true

      buffers.update({ positions, barys, randoms, buildings, verticesProcessed }, stateTransitioner.getStateIndexes())
      stateTransitioner.setupMetaData(buildingIdxToMetadataList)
      // window.requestIdleCallback(() => stateTransitioner.setupMetaData(buildingIdxToMetadataList))
      play()
    }
  })

  const context = {}
  return ({ time, frame }) => {
    if (!loaded) return
    regl.poll()
    regl.clear({
      color: [1, 1, 1, 1],
      depth: 1
    })
    camera.tick()

    context.time = time
    context.frame = frame
    context.isLoading = false
    context.viewportWidth = WIDTH
    context.viewportHeight = HEIGHT

    stateTransitioner.tick(context, settings)

    regl.clear({
      color: [1, 1, 1, 0],
      depth: 1
    })
    globalStateRender(() => {
      renderBuildings({
        primitive: settings.primitive,
        count: settings.POSITIONS_LENGTH / 3
      })
    })
  }
}

canvasSketch(sketch, {
  animate: true,
  dimensions: [WIDTH, HEIGHT],
  context: 'webgl',
  flush: true, // false?
  playing: false,
  attributes: { antialias: true }
})
