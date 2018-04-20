const glsl = require('glslify')
const { scaleSequential } = require('d3-scale')
const { interpolateCool, interpolateMagma } = require('d3-scale-chromatic')
const { rgb } = require('d3-color')
const buildingClassToHues = require('./building-classes')

module.exports = function createStateTransitioner (regl, settings) {
  let lastColorCodeField = settings.colorCodeField
  let lastChangeTime

  const buildingStateTextureSize = Math.ceil(Math.sqrt(settings.BUILDINGS_COUNT)) * 4
  const buildingStateTextureLength = buildingStateTextureSize * buildingStateTextureSize
  const initialBuildingState = new Uint8Array(buildingStateTextureLength * 4)
  for (let i = 0; i < buildingStateTextureLength; ++i) {
    initialBuildingState[i * 4] = 1 // r
    initialBuildingState[i * 4 + 1] = 1 // g
    initialBuildingState[i * 4 + 2] = 1 // b
    initialBuildingState[i * 4 + 3] = 0 // a
  }

  let prevBuildingStateTexture = createStateBuffer(initialBuildingState, buildingStateTextureSize)
  let curBuildingStateTexture = createStateBuffer(initialBuildingState, buildingStateTextureSize)
  let nextbuildingStateTexture = createStateBuffer(initialBuildingState, buildingStateTextureSize)

  const buildingMetaDataState = new Uint8Array(buildingStateTextureLength * 4)
  const buildingMetaDataTexture = regl.texture({
    data: buildingMetaDataState,
    shape: [buildingStateTextureSize, buildingStateTextureSize, 4]
  })
  const buildingMetaDataBuffer = regl.framebuffer({
    color: buildingMetaDataTexture,
    depth: false,
    stencil: false
  })

  const stateIndexes = []

  for (let j = 0; j < settings.BUILDINGS_COUNT; j++) {
    const buildingStateIndexX = (j * 4) % buildingStateTextureSize
    const buildingStateIndexY = (j * 4) / buildingStateTextureSize | 0
    stateIndexes.push([buildingStateIndexX / buildingStateTextureSize, buildingStateIndexY / buildingStateTextureSize])
  }

  const updateState = regl({
    framebuffer: () => nextbuildingStateTexture,

    vert: glsl`
      precision mediump float;
      attribute vec2 position;

      varying vec2 buildingStateIndex;

      void main() {
        // map bottom left -1,-1 (normalized device coords) to 0,0 (particle texture index)
        // and 1,1 (ndc) to 1,1 (texture)
        buildingStateIndex = 0.5 * (1.0 + position);
        gl_Position = vec4(position, 0, 1);
      }
    `,
    frag: glsl`
      precision mediump float;

      uniform sampler2D curBuildingStateTexture;
      uniform sampler2D prevBuildingStateTexture;
      uniform sampler2D buildingMetaDataBuffer;

      uniform float texelSize;
      uniform float animationSpeed;
      uniform float animationSpread;
      uniform float time;
      uniform float lastChangeTime;

      uniform bool showBuilt;
      uniform bool showClass;
      uniform bool showHeight;
      uniform bool isLoading;

      varying vec2 buildingStateIndex;

      void main() {
        vec4 curColor = texture2D(curBuildingStateTexture, buildingStateIndex);
        // vec4 prevColor = texture2D(prevBuildingStateTexture, buildingStateIndex);

        vec4 firstSlot = texture2D(buildingMetaDataBuffer, buildingStateIndex);
        float distFromCenter = firstSlot.a;

        vec4 destColor = vec4(1, 1, 1, 0);
        if (isLoading) {
          if (firstSlot.r == 1.0) {
            destColor = vec4(0.22, 0.22, 0.25, 0.6);
          } else {
            destColor = curColor;
          }
        } else {
          if (showBuilt) {
            destColor = vec4(firstSlot.rgb, 1);
          }
          if (showClass) {
            destColor = vec4(texture2D(buildingMetaDataBuffer, buildingStateIndex + vec2(texelSize, 0) * 2.0).rgb, 1);
          }
          if (showHeight) {
            destColor = vec4(texture2D(buildingMetaDataBuffer, buildingStateIndex + vec2(texelSize, 0) * 3.0).rgb, 1);
          }
        }

        // TEMP EXPERIMENT: Let's store height in the alpha channel just to see if it works well
        if (destColor.rgb != vec3(0)) {
          destColor.a = 1.0;
        }

        if (destColor.rgb == vec3(0)) {
          destColor = vec4(0.4, 0.4, 0.4, 0.3);
          // EXPERIMENT! - set height offset in alpha channel
          destColor.a = 0.0;
        }

        // POTENTIAL OPTIMISATION: if curColor is within range of destColor, 
        // just skip the calculations and set to destColor

        // distFromCenter is a float between 0->1
        // transition over 2 seconds
        float start = pow(distFromCenter, 1.5) * animationSpread + lastChangeTime;
        float rate = (isLoading || time > start) ? 1.0 : 0.0;
        vec4 nextColor = curColor + (destColor - curColor) * animationSpeed * rate;

        gl_FragColor = nextColor;
      }
    `,

    attributes: {
      position: [
        -1, -1,
        1, -1,
        -1, 1,
        1, 1
      ]
    },

    uniforms: {
      curBuildingStateTexture: () => curBuildingStateTexture,
      prevBuildingStateTexture: () => prevBuildingStateTexture,
      buildingMetaDataBuffer: () => buildingMetaDataBuffer,
      texelSize: 1 / buildingStateTextureSize,
      lastChangeTime: () => lastChangeTime * 1000,
      time: ({ time }) => time * 1000,
      animationSpeed: regl.prop('animationSpeed'),
      animationSpread: regl.prop('animationSpread'),
      showBuilt: regl.prop('showBuilt'),
      showClass: regl.prop('showClass'),
      showHeight: regl.prop('showHeight'),
      isLoading: regl.prop('isLoading')
    },

    count: 4,
    primitive: 'triangle strip'
  })

  let lastIdxLoaded = 0
  function updateLoadingState(buildingIdxToMetadataList) {
    for (let j = lastIdxLoaded; j < buildingIdxToMetadataList.length; j += 1) {
      buildingMetaDataState[j * 16] = 255
      lastIdxLoaded = j
    }
    buildingMetaDataTexture({ data: buildingMetaDataState, shape: [buildingStateTextureSize, buildingStateTextureSize, 4] })
    buildingMetaDataBuffer({
      color: buildingMetaDataTexture,
      depth: false,
      stencil: false
    })
  }

  function setupMetaData(buildingIdxToMetadataList) {
    const buildings = buildingIdxToMetadataList
    for (let j = 0; j < settings.BUILDINGS_COUNT; j++) {
      const metadata = buildings[j]
      let metadataValue, color

      metadataValue = metadata ? metadata['built'] : null
      color = metadataValue ? fieldToColorMappers['built'](metadataValue) : [0, 0, 0]
      buildingMetaDataState[j * 16] = color[0] * 255
      buildingMetaDataState[j * 16 + 1] = color[1] * 255
      buildingMetaDataState[j * 16 + 2] = color[2] * 255

      // max distance we're encountering here is around 50, so i'll multiply these by 4
      const center = [10.38, 21.57]
      buildingMetaDataState[j * 16 + 3] = distance(metadata['centroid'], center) * 4

      // metadataValue = metadata ? metadata['zone'] : null
      // color = metadataValue ? fieldToColorMappers['zone'](metadataValue) : [0, 0, 0]
      // buildingMetaDataState[j * 16 + 4] = color[0] * 255
      // buildingMetaDataState[j * 16 + 5] = color[1] * 255
      // buildingMetaDataState[j * 16 + 6] = color[2] * 255

      metadataValue = metadata ? metadata['class'] : null
      color = metadataValue ? fieldToColorMappers['class'](metadataValue) : [0, 0, 0]
      buildingMetaDataState[j * 16 + 8] = color[0] * 255
      buildingMetaDataState[j * 16 + 9] = color[1] * 255
      buildingMetaDataState[j * 16 + 10] = color[2] * 255

      metadataValue = metadata ? metadata['height'] : null
      color = metadataValue ? fieldToColorMappers['height'](metadataValue) : [0, 0, 0]
      buildingMetaDataState[j * 16 + 12] = color[0] * 255
      buildingMetaDataState[j * 16 + 13] = color[1] * 255
      buildingMetaDataState[j * 16 + 14] = color[2] * 255
    }
    buildingMetaDataTexture({ data: buildingMetaDataState, shape: [buildingStateTextureSize, buildingStateTextureSize, 4] })
    buildingMetaDataBuffer({
      color: buildingMetaDataTexture,
      depth: false,
      stencil: false
    })
  }

  function getStateIndexes () {
    return stateIndexes
  }

  function tick (context, curSettings) {
    if (curSettings.colorCodeField !== lastColorCodeField || !lastChangeTime) {
      lastChangeTime = context.time
      lastColorCodeField = curSettings.colorCodeField
    }
    cycleStates()
    updateState({
      animationSpread: curSettings.animationSpread,
      animationSpeed: context.isLoading ? curSettings.loadingAnimationSpeed : curSettings.animationSpeed,
      showBuilt: curSettings.colorCodeField === 'built',
      showClass: curSettings.colorCodeField === 'class',
      showHeight: curSettings.colorCodeField === 'height',
      isLoading: context.isLoading
    })
  }

  function getStateTexture () {
    return curBuildingStateTexture
  }

  return {
    tick,
    getStateTexture,
    getStateIndexes,
    setupMetaData,
    updateLoadingState
  }

  function createStateBuffer (initialState, textureSize) {
    return regl.framebuffer({
      color: regl.texture({
        data: initialState,
        shape: [textureSize, textureSize, 4]
      }),
      depth: false,
      stencil: false
    })
  }

  function cycleStates () {
    const tmp = prevBuildingStateTexture
    prevBuildingStateTexture = curBuildingStateTexture
    curBuildingStateTexture = nextbuildingStateTexture
    nextbuildingStateTexture = tmp
  }
}

const fieldToColorMappers = {
  class(val) {
    const buildingClass = getBuildingClass(val)
    if (!buildingClass) return [0, 0, 0]
    const color = buildingClassToHues[buildingClass]
    return color.map(v => v / 255)
  },
  height: (function() {
    const domain = [0, 1.6] // [0 - 1800 feet]
    const scale = scaleSequential(interpolateCool).domain(domain)
    return (val) => {
      const color = rgb(scale(val))
      return [color.r, color.g, color.b].map(v => v / 255)
    }
  })(),
  built: (function() {
    const domain = [1840, 2019]
    const scale = scaleSequential(interpolateMagma).domain(domain)
    return (val) => {
      if (val < 1800) return [0, 0, 0]
      const color = rgb(scale(val))
      return [color.r, color.g, color.b].map(v => v / 255)
    }
  })()
}

function getBuildingClass(val) {
  switch (val[0]) {
    case 'A': // one family dwellings
    case 'B': // two family dwellings
      return 'one-or-two-family'
    case 'C': // walk up apartments
    case 'S': // residence- multiple use
      if (['6', '8'].includes(val[1])) return 'co-op'
      return 'walkup-and-mixed-use'
    case 'D': // elevator apartments
      if (['0', '4'].includes(val[1])) return 'co-op'
      return 'elevator'
    case 'R': // condominiums
      if (['0', '1', '2', '3', '4', '6', 'D', 'M', 'R', 'X', 'Z'].includes(val[1])) return 'condo'
      if (['9'].includes(val[1])) return 'co-op'
      if (['H'].includes(val[1])) return 'hotel'
      return false
    case 'H': // hotels
      if (['8'].includes(val[1])) return 'elevator' // 'dorm'
      return 'hotel'
    default:
      return false
  }
}

function distance(a, b) {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  return Math.sqrt(x * x + y * y)
}
