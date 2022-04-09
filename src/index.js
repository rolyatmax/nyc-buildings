require('ric')
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
const createBuffers = require('./create-buffers')
const cameraPositions = require('./camera-positions')
const showBrowserWarning = require('./browser-warning')

showBrowserWarning().then(function start() {
  const canvas = document.querySelector('.viz')
  window.addEventListener('resize', fit(canvas), false)
  const regl = createRegl({
    extensions: ['oes_standard_derivatives'],
    canvas: canvas,
    attributes: {
      antialias: false
    }
  })

  const getProjection = () => mat4.perspective(
    [],
    Math.PI / 4,
    window.innerWidth / window.innerHeight,
    0.01,
    1000
  )

  const camera = createRoamingCamera(
    canvas,
    cameraPositions.onStart.center,
    cameraPositions.onStart.eye,
    getProjection,
    cameraPositions.positions
  )

  const settings = {
    objectStorageURL: 'https://nyc-buildings.s3.amazonaws.com/',
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

  const createSettingEvent = (name) => () => { if (!window.IS_DEV) window.ga('send', 'event', 'Settings', 'click', name) }

  const gui = new GUI()
  gui.closed = true
  gui.add(settings, 'wireframeThickness', 0, 0.1).step(0.001).onFinishChange(createSettingEvent('wireframeThickness'))
  gui.add(settings, 'wireframeDistanceThreshold', 1, 20).step(1).onFinishChange(createSettingEvent('wireframeDistanceThreshold'))
  gui.add(settings, 'primitive', ['triangles', 'triangle strip', 'lines', 'line strip', 'points']).onFinishChange(createSettingEvent('primitive'))
  gui.add(settings, 'opacity', 0, 1).step(0.01).onFinishChange(createSettingEvent('opacity'))
  gui.add(settings, 'showFewerBuildings').name('Fewer Buildings').onFinishChange(createSettingEvent('showFewerBuildings'))
  gui.add({ roam: camera.startRoaming }, 'roam').name('Move Camera').onFinishChange(createSettingEvent('moveCamera'))

  gui.domElement.querySelector('.close-button').addEventListener('click', createSettingEvent('open'))

  const renderButtons = createButtons(document.querySelector('.button-group'), settings)
  renderButtons(settings)

  const buffers = createBuffers(regl, settings)

  let globalStateRender, stateTransitioner, renderBuildings
  let loaded = false

  const loader = createLoaderRenderer(document.querySelector('.loader'))

  const renderFxaa = createFxaaRenderer(regl)
  loadData(regl, settings, {
    onDone({ positions, barys, randoms, buildings, buildingIdxToMetadataList, verticesProcessed }) {
      loader.render(1)
      buffers.update({ positions, barys, randoms, buildings, verticesProcessed }, stateTransitioner.getStateIndexes())
      setTimeout(() => {
        loader.remove()
        camera.updateSpeed(0.005, 0.02)
        camera.moveTo(cameraPositions.onFinishLoad)
        setTimeout(() => {
          document.body.classList.remove('for-intro')
          loaded = true
          window.requestIdleCallback(() => stateTransitioner.setupMetaData(buildingIdxToMetadataList))
          setTimeout(camera.startRoaming, 5000)
          if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'completed')
        }, 1500)
      }, 200)
    },
    onStart(getLatest) {
      stateTransitioner = createStateTransitioner(regl, settings)
      const attrs = buffers.getAttributes()
      renderBuildings = createBuildingsRenderer(regl, attrs.positions, attrs.barys, attrs.randoms, attrs.stateIndexes, settings)

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
          curPositionsLoaded = latest.verticesProcessed
          stateTransitioner.updateLoadingState(latest.buildingIdxToMetadataList)
          buffers.update(latest, stateTransitioner.getStateIndexes())
          loader.render(latest.verticesProcessed / (settings.POSITIONS_LENGTH / 3))
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
    if (!window.IS_DEV) window.ga('send', 'event', 'Autopilot Button', 'click')
  })

  function renderAutopilotButton() {
    if (camera.isRoaming()) {
      autopilotButton.classList.add('hidden')
    } else {
      autopilotButton.classList.remove('hidden')
    }
  }

  document.querySelector('a.github-link').addEventListener('click', () => { if (!window.IS_DEV) window.ga('send', 'event', 'Links', 'click', 'github') })
  document.querySelector('a.twitter-link').addEventListener('click', () => { if (!window.IS_DEV) window.ga('send', 'event', 'Links', 'click', 'twitter') })
})
