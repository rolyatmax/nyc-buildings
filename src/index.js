const createRegl = require('regl')
const fit = require('canvas-fit')
const glsl = require('glslify')
const mat4 = require('gl-mat4')
const { scaleSequential } = require('d3-scale')
const { interpolateGnBu } = require('d3-scale-chromatic')
const { rgb } = require('d3-color')
// const createCamera = require('3d-view-controls')
const createPerspectiveCamera = require('perspective-camera')
const createRoamingCamera = require('./create-roaming-camera')
const { GUI } = require('dat-gui')
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
      center: camera.center.map(v => parseFloat(v)).join(', '),
      eye: camera.eye.map(v => parseFloat(v)).join(', ')
    })
  }
})

const camera2 = createPerspectiveCamera({
  fov: Math.PI / 2,
  near: 0.01,
  far: 1000,
  viewport: [0, 0, canvas.width, canvas.height]
})

camera2.translate([-3, 22, 0.7])
camera2.lookAt([10, 20, 0])
camera2.up = [0, 0, 99999]
camera2.update()
window.camera2 = camera2

const settings = {
  lightSourceX: -100,
  lightSourceY: 0,
  lightSourceZ: 20,
  wireframeThickness: 0.1,
  opacity: 0.45,
  t: 0,
  colorCodeField: 'YearBuilt'
}

const gui = new GUI()
gui.add(settings, 'lightSourceX', -500, 500).step(1)
gui.add(settings, 'lightSourceY', -500, 500).step(1)
gui.add(settings, 'lightSourceZ', -500, 500).step(1)
gui.add(settings, 'wireframeThickness', 0, 0.35).step(0.001)
gui.add(settings, 'opacity', 0, 1).step(0.01)
gui.add(settings, 't', 0, 1).step(0.01)
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
  const rows = lines.slice(1).map(l => {
    const row = splitOnCSVComma(l)
    bblToMetadataMap[row[bblColIDX]] = row
    bblToMetadataMap[row[appbblColIDX]] = row
    return row
  })
  return {
    headerMap,
    rows,
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

function getColorAttributes(mesh, metadata, binToBBLMap, fieldName) {
  const { positions, buildings, buildingIdxToBinMap, buildingIdxToHeight, buildingIdxToWidth } = mesh
  const { headerMap, bblToMetadataMap } = metadata
  const colors = []
  const colorCache = {}

  const scale = scaleSequential(interpolateGnBu).domain([0.1, 1.8])

  let r, g, b, lastBuilding
  let noBBLFound = 0
  let noMetadataRowFound = 0
  let metadataFound = 0
  let noMetadataFieldFound = 0
  for (let j = 0; j < positions.length / 3; j += 1) {
    if (buildings[j] !== lastBuilding) {
      const bin = buildingIdxToBinMap[buildings[j]]
      const bbl = binToBBLMap[bin]
      if (!bbl) noBBLFound += 1
      const metadataRow = bblToMetadataMap[bbl]
      if (!metadataRow) noMetadataRowFound += 1
      if (metadataRow) metadataFound += 1
      const fieldIdx = headerMap[fieldName]
      // const metadataValue = metadataRow ? metadataRow[fieldIdx] : '???'
      const metadataValue = buildingIdxToHeight[buildings[j]]
      // const metadataValue = buildingIdxToWidth[buildings[j]]
      if (!metadataValue) noMetadataFieldFound += 1
      if (colorCache[metadataValue]) {
        r = colorCache[metadataValue][0]
        g = colorCache[metadataValue][1]
        b = colorCache[metadataValue][2]
      } else {
        const color = rgb(scale(metadataValue))
        r = !metadataRow ? 0 : color.r / 256
        g = !metadataRow ? 0 : color.g / 256
        b = !metadataRow ? 0 : color.b / 256
        colorCache[metadataValue] = [r, g, b]
      }
      lastBuilding = buildings[j]
    }
    colors.push(r, g, b)
  }
  console.log({ noBBLFound, metadataFound, noMetadataRowFound, noMetadataFieldFound })
  console.log({ colorCache })
  return colors
}

function createHeightLineup(mesh) {
  const { buildingIdxToHeight, buildingIdxToWidth, buildingIdxToMinX } = mesh
  console.log(buildingIdxToHeight.length)
  const buildingsByHeight = buildingIdxToHeight
    .map((height, idx) => ({
      index: idx,
      width: buildingIdxToWidth[idx],
      height: height,
      translateX: buildingIdxToMinX[idx] * -1
    }))
    .sort((a, b) => b.height - a.height < 0 ? -1 : 1)
  return buildingsByHeight
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
  const { positions, normals, barys, buildings } = mesh
  const { headerMap } = metadata

  window.mesh = mesh
  window.metadata = metadata
  window.binToBBLMap = binToBBLMap

  const buildingsByHeight = createHeightLineup(mesh)
  console.log(buildingsByHeight)

  gui.add(settings, 'colorCodeField', Object.keys(headerMap)).onChange(() => {
    colors({ data: getColorAttributes(mesh, metadata, binToBBLMap, settings.colorCodeField) })
  })

  const randoms = getEntropyAttributes(mesh, metadata)
  const colors = regl.buffer(getColorAttributes(mesh, metadata, binToBBLMap, settings.colorCodeField))

  const render = regl({
    vert: glsl`
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec3 bary;
      attribute float building;
      attribute float random;
      attribute vec3 color;

      varying vec4 fragColor;
      varying vec3 barycentric;
      varying float camDistance;
      varying float vOpacity;

      uniform float time;
      uniform float startTime;
      uniform vec3 lightSource;
      uniform mat4 projection;
      uniform mat4 view;
      uniform mat4 view2;
      uniform float animationLength;
      // uniform float t;

      float rand(vec2 co){
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
      }

      void main() {
        barycentric = bary;
        vOpacity = 1.0;

        // float start = startTime + random * animationLength;
        // float t = clamp((time - start) / animationLength, 0.0, 1.0);
        // t = pow(1.0 - t, 4.0);

        // float angle = rand(position.xy) * random + time * rand(position.yz);
        // vec3 noiseOffset = vec3(sin(angle), cos(angle), sin(angle)) / 50.0;
        // vec3 posNoise = position.xyz + noiseOffset;

        // float z = mix(position.z, position.z + random * 10.0 + 5.0, t);
        // vec4 firstPos = projection * view * vec4(posNoise, 1.0);
        // vec4 secondPos = projection * view2 * vec4(posNoise, 1.0);
        // vec4 pos = mix(firstPos, secondPos, t);
        // gl_Position = pos;
        // gl_Position = firstPos;

        gl_Position = projection * view * vec4(position.xyz, 1);
        // vOpacity = pow(1.0 - t, 3.0);

        camDistance = gl_Position.z;
        float opacity = pow(1.0 - (gl_Position.z / 500.0), 8.0);

        vec3 lightDirection = lightSource;
        float lighten = clamp(0.0, 1.0, dot(normalize(normal), normalize(lightDirection)));

        fragColor = vec4(color, opacity);
        // fragColor = mix(vec4(color, opacity), vec4(vec3(1), opacity), lighten);
        // fragColor.rgb -= vec3(0.2);
      }
    `,
    frag: glsl`
      #extension GL_OES_standard_derivatives : enable

      precision highp float;
      varying vec4 fragColor;
      varying vec3 barycentric;
      varying float camDistance;
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
      view2: () => camera2.view,
      animationLength: 15,
      time: ({ time }) => time,
      startTime: regl.prop('startTime'),
      t: () => settings.t,
      lightSource: ({ time }) => [
        settings.lightSourceX, // -100, // Math.sin(time / 2) * 1000,
        settings.lightSourceY, // 0, // Math.cos((time + 20) / 3) * 800,
        settings.lightSourceZ // 20 // (Math.sin(time / 7) + 1) * 5
      ],
      thickness: () => settings.wireframeThickness,
      opacity: () => settings.opacity
    },
    attributes: {
      position: positions,
      normal: normals,
      building: buildings,
      bary: barys,
      random: randoms,
      color: colors
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

    renderFxaa(context, () => {
      regl.clear({
        color: [1, 1, 1, 1], // [0.18, 0.18, 0.18, 1],
        depth: 1
      })
      render({ startTime: 1 })
    })
  })
}
