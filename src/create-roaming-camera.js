const mat4 = require('gl-mat4')
const intersect = require('ray-plane-intersection')
const pickRay = require('camera-picking-ray')
// const { createSpring } = require('spring-animator')
const createCamera = require('3d-view-controls')

module.exports = function createRoamingCamera(canvas, center, eye, getProjection, roamingCameraPositions) {
  let isMoving = false
  let isRoaming = true
  let timeout

  canvas.addEventListener('mousedown', stopRoaming)
  canvas.addEventListener('dblclick', onDblClick)

  const camera = createCamera(canvas, {
    zoomSpeed: 4,
    distanceLimits: [0.05, 500]
  })

  const cameraX = createInterpolator(0.005, eye[0])
  const cameraY = createInterpolator(0.005, eye[1])
  const cameraZ = createInterpolator(0.005, eye[2])

  const focusX = createInterpolator(0.02, center[0])
  const focusY = createInterpolator(0.02, center[1])
  const focusZ = createInterpolator(0.02, center[2])

  camera.lookAt(
    eye,
    center,
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
    focusZ.updateValue(0.1)

    // clear this text selection nonsense on screen after double click
    if (document.selection && document.selection.empty) {
      document.selection.empty()
    } else if (window.getSelection) {
      const sel = window.getSelection()
      sel.removeAllRanges()
    }
  }

  function setRandomCameraPosition () {
    const newFocusX = center[0] + (Math.random() - 0.5) * 9
    const newFocusY = center[1] + (Math.random() - 0.5) * 9
    focusX.updateValue(newFocusX)
    focusY.updateValue(newFocusY)
    focusZ.updateValue(0.1)

    // const cameraXPos = cameraX.tick(false)
    // const cameraYPos = cameraY.tick(false)

    cameraX.updateValue(newFocusX + (Math.random() - 0.5) * 20)
    cameraY.updateValue(newFocusY + (Math.random() - 0.5) * 20)
    cameraZ.updateValue(1 + Math.pow(Math.random(), 3) * 25)
  }
  if (isMoving) {
    cameraRoamLoop()
  }

  let curCameraPosition = 0
  function cameraRoamLoop () {
    clearTimeout(timeout)
    timeout = setTimeout(cameraRoamLoop, 15000)
    if (Math.random() < 0.5) {
      curCameraPosition = (curCameraPosition + 1) % roamingCameraPositions.length
      moveTo(roamingCameraPositions[curCameraPosition])
    } else {
      setRandomCameraPosition()
    }
  }

  function moveTo ({ center, eye }) {
    setSpringsToCurrentCameraValues()
    isMoving = true
    focusX.updateValue(center[0])
    focusY.updateValue(center[1])
    focusZ.updateValue(center[2])

    cameraX.updateValue(eye[0])
    cameraY.updateValue(eye[1])
    cameraZ.updateValue(eye[2])
  }

  function updateSpeed (cameraSpeed, focusSpeed) {
    cameraX.updateSpeed(cameraSpeed)
    cameraY.updateSpeed(cameraSpeed)
    cameraZ.updateSpeed(cameraSpeed)

    focusX.updateSpeed(focusSpeed)
    focusY.updateSpeed(focusSpeed)
    focusZ.updateSpeed(focusSpeed)
  }

  function tick () {
    camera.tick()
    camera.eye = [focusX.tick(), focusY.tick(), focusZ.tick()]
    camera.up = [camera.up[0], camera.up[1], 999]
    // camera.center = [camera.center[0], camera.center[1], Math.max(camera.center[2], 0)]
    if (isMoving) {
      camera.center = [cameraX.tick(), cameraY.tick(), cameraZ.tick()]
    }
  }
  function getMatrix () {
    return camera.matrix
  }
  function getCenter () {
    return camera.center
  }
  function getEye() {
    return camera.eye
  }
  function stopRoaming () {
    clearTimeout(timeout)
    timeout = null
    isMoving = false
    isRoaming = false
  }
  function startRoaming () {
    setSpringsToCurrentCameraValues()
    cameraRoamLoop()
    isMoving = true
    isRoaming = true
  }

  function setSpringsToCurrentCameraValues () {
    focusX.updateValue(camera.center[0], false)
    focusY.updateValue(camera.center[1], false)
    focusZ.updateValue(camera.center[2], false)

    cameraX.updateValue(camera.eye[0], false)
    cameraY.updateValue(camera.eye[1], false)
    cameraZ.updateValue(camera.eye[2], false)
  }

  window.camera = camera
  return {
    tick,
    getMatrix,
    getCenter,
    getEye,
    startRoaming,
    isRoaming: () => isRoaming,
    moveTo,
    updateSpeed
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
    updateSpeed: (newSpeed) => {
      speed = newSpeed
    },
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
