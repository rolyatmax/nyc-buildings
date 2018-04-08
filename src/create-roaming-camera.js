const mat4 = require('gl-mat4')
const intersect = require('ray-plane-intersection')
const pickRay = require('camera-picking-ray')
// const { createSpring } = require('spring-animator')
const createCamera = require('3d-view-controls')

module.exports = function createRoamingCamera(canvas, center, eye, getProjection) {
  let isRoaming = false
  let timeout

  canvas.addEventListener('mousedown', stopRoaming)
  canvas.addEventListener('dblclick', onDblClick)

  const camera = createCamera(canvas, {
    zoomSpeed: 4,
    distanceLimits: [0.05, 500]
  })
  const [fX, fY] = eye
  const cameraX = createInterpolator(0.005, center[0])
  const cameraY = createInterpolator(0.005, center[1])
  const cameraZ = createInterpolator(0.005, center[2])

  const focusX = createInterpolator(0.08, fX)
  const focusY = createInterpolator(0.08, fY)

  camera.lookAt(
    center,
    eye,
    [0, 0, 999]
  )

  function onDblClick (e) {
    const [fX, fY] = getIntersection(
      [e.clientX, e.clientY],
      // prob not the best idea since elsewhere we are using `viewportWidth`
      // and `viewportHeight` passed by regl
      [0, 0, window.innerWidth, window.innerHeight],
      getProjection(),
      camera.matrix
    )
    setSpringsToCurrentCameraValues()
    focusX.updateValue(fX)
    focusY.updateValue(fY)

    // clear this text selection nonsense on screen after double click
    if (document.selection && document.selection.empty) {
      document.selection.empty()
    } else if (window.getSelection) {
      const sel = window.getSelection()
      sel.removeAllRanges()
    }
  }

  function setRandomCameraPosition () {
    const newFocusX = fX + (Math.random() - 0.5) * 10
    const newFocusY = fY + (Math.random() - 0.5) * 10
    focusX.updateValue(newFocusX)
    focusY.updateValue(newFocusY)

    // const cameraXPos = cameraX.tick(false)
    // const cameraYPos = cameraY.tick(false)

    cameraX.updateValue(newFocusX + (Math.random() - 0.5) * 10)
    cameraY.updateValue(newFocusY + (Math.random() - 0.5) * 10)
    cameraZ.updateValue(1 + Math.pow(Math.random(), 4) * 30)
  }
  if (isRoaming) {
    cameraRoamLoop()
  }

  function cameraRoamLoop () {
    clearTimeout(timeout)
    timeout = setTimeout(cameraRoamLoop, 10000)
    setRandomCameraPosition()
  }

  function tick () {
    camera.tick()
    camera.eye = [focusX.tick(), focusY.tick(), 0.5]
    camera.up = [camera.up[0], camera.up[1], 999]
    if (isRoaming) {
      camera.center = [cameraX.tick(), cameraY.tick(), cameraZ.tick()]
    }
  }
  function getMatrix () {
    return camera.matrix
  }
  function getCenter () {
    return camera.center
  }
  function stopRoaming () {
    clearTimeout(timeout)
    timeout = null
    isRoaming = false
  }
  function startRoaming () {
    setSpringsToCurrentCameraValues()
    cameraRoamLoop()
    isRoaming = true
  }

  function setSpringsToCurrentCameraValues () {
    focusX.updateValue(camera.center[0], false)
    focusY.updateValue(camera.center[1], false)

    cameraX.updateValue(camera.eye[0], false)
    cameraY.updateValue(camera.eye[1], false)
    cameraZ.updateValue(camera.eye[2], false)
  }

  window.camera = camera
  return {
    tick,
    getMatrix,
    getCenter,
    startRoaming
  }
}

function getIntersection(mouse, viewport, projection, view) {
  const projView = mat4.multiply([], projection, view)
  const invProjView = mat4.invert([], projView)
  const rayOrigin = []
  const rayDir = []
  pickRay(rayOrigin, rayDir, mouse, viewport, invProjView)
  const normal = [0, 0, 1]
  const distance = 0
  return intersect([], rayOrigin, rayDir, normal, distance)
}

function createInterpolator(speed, value) {
  let curValue = value
  let destValue = value
  return {
    updateValue: (val, shouldAnimate) => {
      destValue = val
      if (shouldAnimate === false) curValue = val
    },
    tick: (shouldAnimate) => {
      const diff = (destValue - curValue)
      let nextValue = curValue
      if (Math.abs(diff) < 0.005) {
        nextValue = destValue
      } else {
        nextValue += diff * speed
      }
      if (shouldAnimate !== false) {
        curValue = nextValue
      }
      return nextValue
    }
  }
}
