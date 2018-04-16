const glsl = require('glslify')
const { scaleSequential } = require('d3-scale')
const { interpolateGnBu, interpolateCool } = require('d3-scale-chromatic')
const { rgb } = require('d3-color')

module.exports = function createStateTransitioner (regl, buildingIdxToMetadataList, settings) {
  let lastColorCodeField = settings.colorCodeField
  let lastChangeTime

  const buildings = buildingIdxToMetadataList
  const buildingStateTextureSize = Math.ceil(Math.sqrt(buildings.length)) * 4
  const buildingStateTextureLength = buildingStateTextureSize * buildingStateTextureSize
  const initialBuildingState = new Uint8Array(buildingStateTextureLength * 4)
  for (let i = 0; i < buildingStateTextureLength; ++i) {
    initialBuildingState[i * 4] = 0 // r
    initialBuildingState[i * 4 + 1] = 0 // g
    initialBuildingState[i * 4 + 2] = 0 // b
  }

  let prevBuildingStateTexture = createStateBuffer(initialBuildingState, buildingStateTextureSize)
  let curBuildingStateTexture = createStateBuffer(initialBuildingState, buildingStateTextureSize)
  let nextbuildingStateTexture = createStateBuffer(initialBuildingState, buildingStateTextureSize)

  const stateIndexes = []
  const buildingMetaDataState = new Uint8Array(buildingStateTextureLength * 4)
  for (let j = 0; j < buildings.length; j++) {
    const buildingStateIndexX = (j * 4) % buildingStateTextureSize
    const buildingStateIndexY = (j * 4) / buildingStateTextureSize | 0
    stateIndexes.push([buildingStateIndexX / buildingStateTextureSize, buildingStateIndexY / buildingStateTextureSize])

    const metadata = buildings[j]
    let metadataValue, color

    metadataValue = metadata ? metadata['built'] : null
    color = metadataValue ? fieldToColorMappers['built'](metadataValue) : [0.1, 0.1, 0.1]
    buildingMetaDataState[j * 16] = color[0] * 255
    buildingMetaDataState[j * 16 + 1] = color[1] * 255
    buildingMetaDataState[j * 16 + 2] = color[2] * 255

    // max distance we're encountering here is around 50, so i'll multiply these by 4
    const center = [10.38, 21.57]
    buildingMetaDataState[j * 16 + 3] = distance(metadata['centroid'], center) * 4

    metadataValue = metadata ? metadata['zone'] : null
    color = metadataValue ? fieldToColorMappers['zone'](metadataValue) : [0.1, 0.1, 0.1]
    buildingMetaDataState[j * 16 + 4] = color[0] * 255
    buildingMetaDataState[j * 16 + 5] = color[1] * 255
    buildingMetaDataState[j * 16 + 6] = color[2] * 255

    metadataValue = metadata ? metadata['class'] : null
    color = metadataValue ? fieldToColorMappers['class'](metadataValue) : [0.1, 0.1, 0.1]
    buildingMetaDataState[j * 16 + 8] = color[0] * 255
    buildingMetaDataState[j * 16 + 9] = color[1] * 255
    buildingMetaDataState[j * 16 + 10] = color[2] * 255

    metadataValue = metadata ? metadata['height'] : null
    color = metadataValue ? fieldToColorMappers['height'](metadataValue) : [0.1, 0.1, 0.1]
    buildingMetaDataState[j * 16 + 12] = color[0] * 255
    buildingMetaDataState[j * 16 + 13] = color[1] * 255
    buildingMetaDataState[j * 16 + 14] = color[2] * 255
  }

  const buildingMetaDataTexture = createStateBuffer(buildingMetaDataState, buildingStateTextureSize)

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
      uniform sampler2D buildingMetaDataTexture;

      uniform float texelSize;
      uniform float animationSpeed;
      uniform float animationSpread;
      uniform float time;
      uniform float lastChangeTime;

      uniform bool showBuilt;
      uniform bool showZone;
      uniform bool showClass;
      uniform bool showHeight;

      varying vec2 buildingStateIndex;

      void main() {
        vec3 curColor = texture2D(curBuildingStateTexture, buildingStateIndex).rgb;
        // vec3 prevColor = texture2D(prevBuildingStateTexture, buildingStateIndex).rgb;

        vec4 firstSlot = texture2D(buildingMetaDataTexture, buildingStateIndex);
        float distFromCenter = firstSlot.a;

        vec3 destColor = vec3(0);
        if (showBuilt) {
          destColor = firstSlot.rgb;
        }
        if (showZone) {
          destColor = texture2D(buildingMetaDataTexture, buildingStateIndex + vec2(texelSize, 0)).rgb;
        }
        if (showClass) {
          destColor = texture2D(buildingMetaDataTexture, buildingStateIndex + vec2(texelSize, 0) * 2.0).rgb;
        }
        if (showHeight) {
          destColor = texture2D(buildingMetaDataTexture, buildingStateIndex + vec2(texelSize, 0) * 3.0).rgb;
        }

        // POTENTIAL OPTIMISATION: if curColor is within range of destColor, 
        // just skip the calculations and set to destColor

        // distFromCenter is a float between 0->1
        // transition over 2 seconds
        float start = pow(distFromCenter, 1.5) * animationSpread + lastChangeTime;
        float rate = time > start ? 1.0 : 0.0;
        vec3 nextColor = curColor + (destColor - curColor) * animationSpeed * rate;

        // NOTE: use alpha position for z translate? To raise some buildings off the ground?

        gl_FragColor = vec4(nextColor, 0.0);
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
      buildingMetaDataTexture: buildingMetaDataTexture,
      texelSize: 1 / buildingStateTextureSize,
      lastChangeTime: () => lastChangeTime * 1000,
      time: ({ time }) => time * 1000,
      animationSpeed: regl.prop('animationSpeed'),
      animationSpread: regl.prop('animationSpread'),
      showBuilt: regl.prop('showBuilt'),
      showZone: regl.prop('showZone'),
      showClass: regl.prop('showClass'),
      showHeight: regl.prop('showHeight')
    },

    count: 4,
    primitive: 'triangle strip'
  })

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
      animationSpeed: curSettings.animationSpeed,
      showBuilt: curSettings.colorCodeField === 'built',
      showZone: curSettings.colorCodeField === 'zone',
      showClass: curSettings.colorCodeField === 'class',
      showHeight: curSettings.colorCodeField === 'height'
    })
  }

  function getStateTexture () {
    return curBuildingStateTexture
  }

  return {
    tick,
    getStateTexture,
    getStateIndexes
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

// use HSL for these?
window.bldgClassCounts = {}
const fieldToColorMappers = {
  class(val) {
    window.bldgClassCounts[val] = window.bldgClassCounts[val] || 0
    window.bldgClassCounts[val] += 1
    switch (val[0]) {
      case 'A': // one family dwellings
        return [256, 0, 256].map(v => v / 256)
      case 'B': // two family dwellings
        return [0, 256, 256].map(v => v / 256)
      case 'C': // walk up apartments
        return [256, 256, 0].map(v => v / 256)
      case 'D': // elevator apartments
        return [0, 0, 256].map(v => v / 256)
      case 'R': // condominiums
        if (!['1', '2', '3', '4', '6', '9', 'D', 'M', 'R'].includes(val[1])) return [0.4, 0.4, 0.4]
        return [0, 256, 0].map(v => v / 256)
      case 'S': // residence- multiple use
        return [256, 0, 0].map(v => v / 256)
        // return [161, 217, 155].map(v => v / 256)
      default:
        return [0.4, 0.4, 0.4]

      // case 'H': // hotels
      //   return [136, 86, 167].map(v => v / 256)
      // case 'J': // theatres
      // case 'K': // store buildings (taxpayers included)
      // case 'L': // loft buildings
      //   return [158, 202, 225].map(v => v / 256)
      // case 'O': // office buildings
      //   return [49, 130, 189].map(v => v / 256)
      // case 'M': // churches, synagogues
      // case 'P': // places of public assembly (indoor)
      // case 'Q': // outdoor recreation facilities
      //   return [229, 245, 224].map(v => v / 256)
      // case 'E': // warehouses
      // case 'F': // factory & industrial buildings
      // case 'G': // garages and gasoline stations
      // case 'I': // hospitals and health
      // case 'N': // asylums and homes
      // case 'T': // transportation facilities
      // case 'U': // utility bureau properties
      // case 'V': // vacant land
      // case 'W': // educational structures
      // case 'Y': // selected government installations
      // case 'Z': // misc
      // default:
      //   return [0.4, 0.4, 0.4]
    }
  },
  zone(val) {
    if (val[0] === 'R') return [49, 163, 84].map(v => v / 256)
    if (val[0] === 'C') return [49, 130, 189].map(v => v / 256)
    if (val[0] === 'M') return [254, 178, 76].map(v => v / 256)
    if (val.slice(0, 4) === 'PARK') return [229, 245, 224].map(v => v / 256)
    return [0.4, 0.4, 0.4]
  },
  height: (function() {
    const domain = [0, 1.6] // 0 - 1800 feet
    const scale = scaleSequential(interpolateCool).domain(domain)
    return (val) => {
      const color = rgb(scale(val))
      return [color.r, color.g, color.b].map(v => v / 256)
    }
  })(),
  built: (function() {
    const domain = [2017, 1820]
    const scale = scaleSequential(interpolateGnBu).domain(domain)
    return (val) => {
      if (domain[1] > val) return [0.1, 0.1, 0.1]
      const color = rgb(scale(val))
      return [color.r, color.g, color.b].map(v => v / 256)
    }
  })()
}

function distance(a, b) {
  const x = b[0] - a[0]
  const y = b[1] - a[1]
  return Math.sqrt(x * x + y * y)
}
