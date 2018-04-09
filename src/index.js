const createRegl = require('regl')
const fit = require('canvas-fit')
const glsl = require('glslify')
const mat4 = require('gl-mat4')
const { GUI } = require('dat-gui')
const createRoamingCamera = require('./create-roaming-camera')
const createStateTransitioner = require('./create-state-transitioner')
const createMesh = require('./create-mesh')
const createFxaaRenderer = require('./render-fxaa')

const canvas = document.body.appendChild(document.createElement('canvas'))
window.addEventListener('resize', fit(canvas), false)
const regl = createRegl({
  extensions: ['oes_standard_derivatives', 'oes_texture_float'],
  canvas: canvas
})

const getProjection = () => mat4.perspective(
  [],
  Math.PI / 4,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
)

// sideview of Manhattan:
// center: "6.651801509045625, 16.327148056768706, -0.07823453668244912"
// eye: "31.161953007311798, 5.723376647221853, 0.08826498790471207"
const center = [0, 0, 10]
const eye = [4, 8, 0]
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
  colorCodeField: 'BldgClass'
}

const gui = new GUI()
gui.add(settings, 'wireframeThickness', 0, 0.35).step(0.001)
gui.add(settings, 'opacity', 0, 1).step(0.01)
gui.add(settings, 'animationSpeed', 0, 0.5).step(0.001)
gui.add(settings, 'animationSpread', 1, 20000).step(1)
gui.add(settings, 'colorCodeField', ['YearBuilt', 'BldgClass', 'ZoneDist1'])
gui.add({ roam: camera.startRoaming }, 'roam')

const geometryFetch = window.fetch('models/manhattan.indexed.building.triangles.binary')
  .then(res => res.arrayBuffer())
  .then(createMesh)

const metadataFetch = window.fetch('models/pluto_csv/MN2017V11.csv')
  .then(res => res.text())
  .then(parseMetadataCSV)

const binToBBLMapFetch = window.fetch('models/bin-to-bbl.csv')
  .then(res => res.text())
  .then(parseBinToBBLMapCSV)

Promise.all([geometryFetch, metadataFetch, binToBBLMapFetch]).then(setup)

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

function getEntropyAttributes(mesh) {
  const { positions, buildings } = mesh
  const randoms = []
  let entropy, lastBuilding
  for (let j = 0; j < positions.length / 3; j += 1) {
    if (buildings[j] !== lastBuilding) {
      entropy = Math.random()
      lastBuilding = buildings[j]
    }
    randoms.push(entropy)
  }
  return randoms
}

function setup([mesh, metadata, binToBBLMap]) {
  const { positions, barys, buildings, buildingIdxToBinMap, buildingIdxToCentroid } = mesh

  // maybe this stuff should be done in a "setupMetadata" step
  const { bblToMetadataMap, headerMap } = metadata
  const buildingIdxToMetadataList = buildingIdxToBinMap.map((bin, idx) => {
    const bbl = binToBBLMap[bin]
    if (!bbl) return { centroid: buildingIdxToCentroid[idx] }
    const row = bblToMetadataMap[bbl]
    if (!row) return { centroid: buildingIdxToCentroid[idx] }
    return {
      centroid: buildingIdxToCentroid[idx],
      YearBuilt: parseInt(row[headerMap['YearBuilt']], 10),
      ZoneDist1: row[headerMap['ZoneDist1']],
      BldgClass: row[headerMap['BldgClass']]
    }
  })

  // returns { tick, getStateTexture, getStateIndexes }
  const stateTransitioner = createStateTransitioner(regl, buildingIdxToMetadataList, settings)
  const buildingIdxToStateIndexes = stateTransitioner.getStateIndexes()
  const stateIndexes = []
  for (let i = 0; i < positions.length / 3; i++) {
    stateIndexes.push(buildingIdxToStateIndexes[buildings[i]])
  }

  window.mesh = mesh
  window.buildingIdxToMetadataList = buildingIdxToMetadataList

  const randoms = getEntropyAttributes(mesh, metadata)

  const render = regl({
    vert: glsl`
      attribute vec3 position;
      attribute vec3 bary;
      attribute float random;
      attribute vec2 stateIndex;

      varying vec4 fragColor;
      varying vec3 barycentric;
      varying float vOpacity;

      uniform sampler2D buildingState;
      uniform mat4 projection;
      uniform mat4 view;

      float rand(vec2 co){
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
      }

      void main() {
        barycentric = bary;
        vOpacity = 1.0;

        vec3 color = texture2D(buildingState, stateIndex).rgb;

        gl_Position = projection * view * vec4(position.xyz, 1);
        float camDistance = clamp(gl_Position.z / 2.0 + 0.5, 0.0, 1.0);
        float opacity = pow(1.0 - camDistance, 8.0);
        fragColor = vec4(color, opacity);
      }
    `,
    frag: glsl`
      #extension GL_OES_standard_derivatives : enable

      precision highp float;
      varying vec4 fragColor;
      varying vec3 barycentric;
      varying float vOpacity;

      uniform float thickness;
      uniform float opacity;

      float aastep (float threshold, float dist) {
        float afwidth = fwidth(dist) * 0.5;
        return smoothstep(threshold - afwidth, threshold + afwidth, dist);
      }

      void main() {
        float d = min(min(barycentric.x, barycentric.y), barycentric.z);
        float positionAlong = max(barycentric.x, barycentric.y);
        if (barycentric.y < barycentric.x && barycentric.y < barycentric.z) {
          positionAlong = 1.0 - positionAlong;
        }
        if (thickness == 0.0) {
          gl_FragColor = vec4(fragColor.rgb, opacity);
        } else {
          float computedThickness = thickness;
          computedThickness *= mix(0.4, 1.0, (1.0 - sin(positionAlong * 3.1415)));
          float edge = 1.0 - aastep(computedThickness, d);
          gl_FragColor = mix(vec4(fragColor.rgb, opacity), vec4(0.18, 0.18, 0.18, 1.0), edge);
        }
        gl_FragColor.a = vOpacity * opacity;
      }
    `,
    uniforms: {
      projection: getProjection,
      view: () => camera.getMatrix(),
      buildingState: stateTransitioner.getStateTexture,
      thickness: () => settings.wireframeThickness,
      opacity: () => settings.opacity
    },
    attributes: {
      position: positions,
      stateIndex: stateIndexes,
      bary: barys,
      random: randoms
    },
    cull: {
      enable: false,
      face: 'back'
    },
    blend: {
      enable: true,
      func: {
        srcRGB: 'src alpha',
        srcAlpha: 1,
        dstRGB: 'one minus src alpha',
        dstAlpha: 1
      },
      equation: {
        rgb: 'add',
        alpha: 'add'
      }
    },
    count: positions.length / 3,
    primitive: 'triangles'
  })

  const renderFxaa = createFxaaRenderer(regl)
  regl.frame((context) => {
    camera.tick()

    stateTransitioner.tick(context, settings)

    renderFxaa(context, () => {
      regl.clear({
        color: [1, 1, 1, 1], // [0.18, 0.18, 0.18, 1],
        depth: 1
      })
      render({ startTime: 1 })
    })
  })
}
