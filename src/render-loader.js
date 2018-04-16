const glsl = require('glslify')

module.exports = function createLoaderRenderer(regl, positionsBuffer, barysBuffer, randomsBuffer, settings) {
  return regl({
    vert: glsl`
      attribute vec3 position;

      varying vec4 fragColor;
      varying float vOpacity;

      uniform mat4 projection;
      uniform mat4 view;

      void main() {
        vOpacity = 1.0;

        vec3 color = vec3(0.15);

        gl_PointSize = 1.0;
        gl_Position = projection * view * vec4(position.xyz, 1);
        float opacity = 0.2;
        fragColor = vec4(color, opacity);
      }
    `,
    frag: glsl`
      precision highp float;
      varying vec4 fragColor;
      varying float vOpacity;

      void main() {
        gl_FragColor = fragColor;
        gl_FragColor.a *= vOpacity;
      }
    `,
    attributes: {
      position: positionsBuffer,
      bary: barysBuffer,
      random: randomsBuffer
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
    count: () => positionsBuffer._buffer.byteLength / 4 / 3,
    primitive: 'lines'
  })
}
