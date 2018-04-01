const createRegl = require('regl')
const fit = require('canvas-fit')
const glsl = require('glslify')
const mat4 = require('gl-mat4')
const getNormal = require('triangle-normal')
const createCamera = require('3d-view-controls')

const canvas = document.body.appendChild(document.createElement('canvas'))
window.addEventListener('resize', fit(canvas), false)
const camera = createCamera(canvas)
const regl = createRegl(canvas)

camera.lookAt(
  [0, 0, 20],
  [10, 20, 0],
  [0, 0, 99999]
)

// const BUILDING_DELIMITER = new Float32Array(Uint8Array.from([1, 2, 3, 4]).buffer)[0]
// const TRIANGLE_STRIP_DELIMITER = new Float32Array(Uint8Array.from([5, 6, 7, 8]).buffer)[0]
const BUILDING_DELIMITER = [255, 255, 255, 255]
const VERTEX_LIST_DELIMITER = [254, 255, 255, 255]

// also: models/manhattan.vertices.deduped.binary
// also: models/DA12_3D_Buildings.surfaces.subset.binary
// also: models/DA12_3D_Buildings.surfaces.binary
// also: models/manhattan.surfaces.binary
window.fetch('models/manhattan.indexed.building.triangles.binary')
  .then(res => res.arrayBuffer())
  .then(setup)

function setup(buffer) {
  const buf = new Uint8Array(buffer)

  const positions = []
  const normals = []
  const buildings = []
  let buildingCount = 0
  let curNormal = [] // reuse this array
  let vertices = [] // reuse this array

  let chunkStart = 0
  let p = 0
  let curVertIdxByteSize = null
  while (p < buf.length) {
    // vertex list delimiter
    if (buf[p] === VERTEX_LIST_DELIMITER[0] && buf[p + 1] === VERTEX_LIST_DELIMITER[1] && buf[p + 2] === VERTEX_LIST_DELIMITER[2] && buf[p + 3] === VERTEX_LIST_DELIMITER[3] && (p - chunkStart) % (4 * 3) === 0 && curVertIdxByteSize === null) {
      processBuildingVertices(chunkStart, p)
      curVertIdxByteSize = buf[p + 4] === 0 ? 1 : 2
      p += 5
      chunkStart = p
      continue
    }

    // building delimiter
    if (buf[p] === BUILDING_DELIMITER[0] && buf[p + 1] === BUILDING_DELIMITER[1] && buf[p + 2] === BUILDING_DELIMITER[2] && buf[p + 3] === BUILDING_DELIMITER[3] && curVertIdxByteSize !== null && (p - chunkStart) % (curVertIdxByteSize * 3) === 0) {
      processBuildingTriangles(chunkStart, p, curVertIdxByteSize)
      curVertIdxByteSize = null
      p += 4
      buildingCount += 1
      chunkStart = p
      continue
    }

    p += 1
  }

  if (chunkStart !== p) {
    console.log('chunkStart does not equal p!')
    console.log('chunkStart:', chunkStart)
    console.log('p:', p)
    throw new Error('UGHHHHHH')
  }

  function processBuildingVertices(chunkStart, chunkEnd) {
    const b = buf.slice(chunkStart, chunkEnd)
    vertices = new Float32Array(b.buffer)
    if (vertices.length % 3 !== 0) throw new Error('ACK! Something is wrong with the vertices!')
  }

  function processBuildingTriangles(chunkStart, chunkEnd, vertIdxByteSize) {
    // if (vertIdxByteSize === 1) return
    const b = buf.slice(chunkStart, chunkEnd)
    const TypedArray = vertIdxByteSize === 1 ? Uint8Array : Uint16Array
    const vertIndexes = new TypedArray(b.buffer)
    if (vertIndexes.length % 3 !== 0) throw new Error('ACK! Something is wrong with the triangles!')
    for (let j = 0; j < vertIndexes.length; j += 3) {
      const v1Idx = vertIndexes[j]
      const v2Idx = vertIndexes[j + 1]
      const v3Idx = vertIndexes[j + 2]

      if (
        !checkVertex(vertices[v1Idx * 3 + 0], vertices[v1Idx * 3 + 1], vertices[v1Idx * 3 + 2]) ||
        !checkVertex(vertices[v2Idx * 3 + 0], vertices[v2Idx * 3 + 1], vertices[v2Idx * 3 + 2]) ||
        !checkVertex(vertices[v3Idx * 3 + 0], vertices[v3Idx * 3 + 1], vertices[v3Idx * 3 + 2])
      ) {
        return
      }

      positions.push(
        vertices[v1Idx * 3 + 0], vertices[v1Idx * 3 + 1], vertices[v1Idx * 3 + 2],
        vertices[v2Idx * 3 + 0], vertices[v2Idx * 3 + 1], vertices[v2Idx * 3 + 2],
        vertices[v3Idx * 3 + 0], vertices[v3Idx * 3 + 1], vertices[v3Idx * 3 + 2]
      )

      buildings.push(buildingCount, buildingCount, buildingCount)

      getNormal(
        vertices[v1Idx * 3 + 0], vertices[v1Idx * 3 + 1], vertices[v1Idx * 3 + 2],
        vertices[v2Idx * 3 + 0], vertices[v2Idx * 3 + 1], vertices[v2Idx * 3 + 2],
        vertices[v3Idx * 3 + 0], vertices[v3Idx * 3 + 1], vertices[v3Idx * 3 + 2],
        curNormal
      )

      normals.push(
        curNormal[0], curNormal[1], curNormal[2],
        curNormal[0], curNormal[1], curNormal[2],
        curNormal[0], curNormal[1], curNormal[2]
      )
    }
  }

  function checkVertex(x, y, z) {
    if (x < 978970 || y < 194470 || z < -40) {
      console.log(`Something wrong with this vertex: ${x}, ${y}, ${z} - building ${buildingCount}`)
      return false
    }
    return true
  }

  console.log(buildingCount)

  // For DA_WISE dataset
  // mins: [ 978979.241500825, 194479.073690146, -39.0158999999985 ]
  // maxs: [ 1009996.30348232, 259992.617531568, 1797.1066 ]
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - 978979.241500825) / 1000
    positions[i + 1] = (positions[i + 1] - 194479.073690146) / 1000
    positions[i + 2] = (positions[i + 2] - 0) / 1000 // -39.0158999999985) / 1000
  }

  // For TUM dataset
  // mins: [298393.34375, 59415.828125, 0]
  // maxs: [307763.84375, 79010.984375, 377.5832824707031]
  // for (let i = 0; i < positions.length; i += 3) {
  //   positions[i] = (positions[i] - 298393.34375) / 1000
  //   positions[i + 1] = (positions[i + 1] - 59415.828125) / 1000
  //   positions[i + 2] = (positions[i + 2] - 0) / 1000
  // }

  const render = regl({
    vert: glsl`
      attribute vec3 position;
      attribute vec3 normal;
      attribute float building;

      varying vec4 fragColor;

      uniform float time;
      uniform vec3 lightSource;
      uniform mat4 projection;
      uniform mat4 view;

      void main() {
        gl_PointSize = 1.0;
        float z = position.z;
        // float z = position.z * sin(time / 2.0 + building) * 5.0;
        gl_Position = projection * view * vec4(position.xy, z, 1.0);
        float opacity = pow(1.0 - (gl_Position.z / 500.0), 8.0);

        vec3 lightDirection = normalize(lightSource - position);
        float dProd = dot(lightDirection, normal);
        float lighten = clamp(dProd, 0.0, 1.0) * 0.65;
        fragColor = vec4(vec3(lighten + 0.3) * opacity, opacity);
        // fragColor = vec4(1.0);

        // vec3 normalizedNormal = (normal + vec3(1.0) / 2.0);
        // float average = (normalizedNormal.x + normalizedNormal.y + normalizedNormal.z) / 3.0;
        // fragColor = vec4(vec3(average) * 0.9 + vec3(0.05), 1.0);
        // fragColor = vec4(normalizedNormal + vec3(0.2), 1.0);
        // fragColor = vec4(vec3(opacity + 0.55), opacity + 0.1);
      }
    `,
    frag: glsl`
      precision highp float;
      varying vec4 fragColor;
      void main() {
        gl_FragColor = fragColor;
      }
    `,
    uniforms: {
      projection: ({viewportWidth, viewportHeight}) => mat4.perspective(
        [],
        Math.PI / 4,
        viewportWidth / viewportHeight,
        0.01,
        1000
      ),
      view: () => camera.matrix,
      time: ({ time }) => time,
      lightSource: ({ time }) => [
        -100, // Math.sin(time / 2) * 1000,
        0, // Math.cos((time + 20) / 3) * 800,
        20 // (Math.sin(time / 7) + 1) * 5
      ]
    },
    attributes: {
      position: positions,
      normal: normals,
      building: buildings
    },
    cull: {
      enable: true,
      face: 'back'
    },
    // blend: {
    //   enable: true,
    //   func: {
    //     srcRGB: 'src alpha',
    //     srcAlpha: 1,
    //     dstRGB: 'one minus src alpha',
    //     dstAlpha: 1
    //   },
    //   equation: {
    //     rgb: 'add',
    //     alpha: 'add'
    //   }
    // },
    count: positions.length / 3,
    primitive: 'triangles'
  })

  console.log(positions.length / 3)

  regl.frame(({ time }) => {
    if (window.stopAnimation) return
    regl.clear({
      color: [0.18, 0.18, 0.18, 1],
      depth: 1
    })
    camera.tick()
    // camera.up = [camera.up[0], camera.up[1], 999]
    const x = Math.sin(time / 5) * 5 + 1
    const y = Math.cos((time + 100) / 3) * 2 + 1
    const z = Math.sin((time + 80) / 6) * 2 + 3

    const xL = Math.sin((time + 20) / 7) * 2 + 8
    const yL = Math.cos((time + 80) / 5) * 6 + 15
    const zL = Math.sin((time) / 9) + 1

    // camera.lookAt(
    //   [x, y, z],
    //   [xL, yL, zL],
    //   [0, 0, 99999]
    // )

    render()
  })
}
