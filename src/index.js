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

// also: models/manhattan.vertices.deduped.binary
// also: models/DA12_3D_Buildings.surfaces.subset.binary
// also: models/DA12_3D_Buildings.surfaces.binary
// also: models/manhattan.surfaces.binary
window.fetch('models/manhattan.triangles.binary')
  .then(res => res.arrayBuffer())
  .then(setup)

function setup(buffer) {
  const b = new Uint8Array(buffer)
  const data = new Float32Array(b.buffer)
  const vertices = data
  const colors = []
  const normals = []
  let curNormal = [] // reuse this array
  for (let p = 0; p < data.length; p += 3 * 3) {
    const r = Math.random()
    const g = Math.random()
    const b = Math.random()
    colors.push(r, g, b, r, g, b, r, g, b)

    getNormal(
      data[p + 0], data[p + 1], data[p + 2],
      data[p + 3], data[p + 4], data[p + 5],
      data[p + 6], data[p + 7], data[p + 8],
      curNormal
    )

    normals.push(
      curNormal[0], curNormal[1], curNormal[2],
      curNormal[0], curNormal[1], curNormal[2],
      curNormal[0], curNormal[1], curNormal[2]
    )
  }

  // for surfaces separated with delimeters - triangle strip
  // const vertices = []
  // let k = 0
  // let firstSurfaceVertex = [data[k], data[k + 1], data[k + 2]]
  // let currentColor = [Math.random(), Math.random(), Math.random()]
  // while (k < data.length - 1) {
  //   if (!Number.isFinite(data[k])) {
  //     vertices.push(firstSurfaceVertex[0], firstSurfaceVertex[1], firstSurfaceVertex[2])
  //     vertices.push(firstSurfaceVertex[0], firstSurfaceVertex[1], firstSurfaceVertex[2])
  //     colors.push(
  //       currentColor[0], currentColor[1], currentColor[2],
  //       currentColor[0], currentColor[1], currentColor[2],
  //       currentColor[0], currentColor[1], currentColor[2],
  //       currentColor[0], currentColor[1], currentColor[2],
  //       currentColor[0], currentColor[1], currentColor[2],
  //       currentColor[0], currentColor[1], currentColor[2]
  //     )
  //     currentColor = [Math.random(), Math.random(), Math.random()]
  //     firstSurfaceVertex = [data[k + 1], data[k + 2], data[k + 3]]
  //     vertices.push(firstSurfaceVertex[0], firstSurfaceVertex[1], firstSurfaceVertex[2])
  //     colors.push(
  //       currentColor[0], currentColor[1], currentColor[2],
  //       currentColor[0], currentColor[1], currentColor[2],
  //       currentColor[0], currentColor[1], currentColor[2]
  //     )
  //     k += 1
  //     continue
  //   }

  //   colors.push(
  //     currentColor[0], currentColor[1], currentColor[2],
  //     currentColor[0], currentColor[1], currentColor[2],
  //     currentColor[0], currentColor[1], currentColor[2]
  //   )
  //   vertices.push(data[k], data[k + 1], data[k + 2])
  //   k += 3
  // }

  // mins: [ 978979.241500825, 194479.073690146, -39.0158999999985 ]
  // maxs: [ 1009996.30348232, 259992.617531568, 1797.1066 ]
  for (let i = 0; i < vertices.length; i += 3) {
    vertices[i] = (vertices[i] - 978979.241500825) / 1000
    vertices[i + 1] = (vertices[i + 1] - 194479.073690146) / 1000
    vertices[i + 2] = (vertices[i + 2] - -39.0158999999985) / 1000
  }

  const render = regl({
    vert: glsl`
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec3 color;

      varying vec4 fragColor;

      uniform vec3 lightSource;
      uniform mat4 projection;
      uniform mat4 view;

      void main() {
        gl_PointSize = 1.0;
        gl_Position = projection * view * vec4(position, 1.0);
        float opacity = pow(1.0 - (gl_Position.z / 500.0), 80.0);

        vec3 lightDirection = normalize(lightSource - position);
        float dProd = dot(lightDirection, normal);
        float lighten = clamp(dProd, 0.0, 1.0) * 0.65;
        fragColor = vec4(vec3(lighten + 0.3) * opacity * 5.0, opacity * 5.0);

        // vec3 normalizedNormal = (normal + vec3(1.0) / 2.0);
        // float average = (normalizedNormal.x + normalizedNormal.y + normalizedNormal.z) / 3.0;
        // fragColor = vec4(vec3(average) * 0.9 + vec3(0.05), 1.0);
        // fragColor = vec4(normalizedNormal + vec3(0.2), 1.0);
        // fragColor = vec4(color, 1.0);
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
      lightSource: ({ time }) => [
        Math.sin(time / 2) * 1000,
        Math.cos((time + 20) / 3) * 800,
        (Math.sin(time / 7) + 1) * 5
      ]
    },
    attributes: {
      position: vertices,
      color: colors,
      normal: normals
    },
    cull: {
      enable: true,
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
    count: vertices.length / 3,
    primitive: 'triangles'
  })

  console.log(vertices.length)

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

    camera.lookAt(
      [x, y, z],
      [xL, yL, zL],
      [0, 0, 99999]
    )

    render()
  })
}
