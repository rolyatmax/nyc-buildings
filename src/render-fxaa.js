const glsl = require('glslify')

module.exports = function createFxaaRenderer(regl) {
  const postProcessingRender = regl({
    vert: glsl`
      precision highp float;
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0, 1);
      }
    `,
    frag: glsl`
      precision highp float;

      #pragma glslify: fxaa = require(glsl-fxaa)

      uniform sampler2D iChannel0;
      uniform vec2 resolution;
      uniform bool enabled;
      
      void main() {
        vec2 uv = vec2(gl_FragCoord.xy / resolution.xy);
      
        // can also use gl_FragCoord.xy
        vec2 fragCoord = uv * resolution; 

        gl_FragColor = fxaa(iChannel0, fragCoord, resolution);
      }
    `,
    uniforms: {
      iChannel0: regl.prop('iChannel0'),
      resolution: ({viewportWidth, viewportHeight}) => [viewportWidth, viewportHeight]
    },
    attributes: {
      position: [
        -1, -1,
        -1, 4,
        4, -1
      ]
    },
    count: 3,
    primitive: 'triangles'
  })

  const tempFbo = regl.framebuffer({
    color: regl.texture({
      shape: [regl._gl.canvas.width, regl._gl.canvas.height, 4]
    }),
    depth: true,
    stencil: false
  })

  return function renderFxaa(context, render) {
    tempFbo.resize(context.viewportWidth, context.viewportHeight)
    regl({ framebuffer: tempFbo })(() => {
      render()
    })
    regl.clear({
      color: [1, 1, 1, 1], // [0.18, 0.18, 0.18, 1],
      depth: 1
    })
    postProcessingRender({ iChannel0: tempFbo })
  }
}
