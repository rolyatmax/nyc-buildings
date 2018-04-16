const glsl = require('glslify')

module.exports = function createBuildingsRenderer(regl, positionsBuffer, barysBuffer, randomsBuffer, stateIndexesBuffer, settings) {
  return regl({
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
      thickness: () => settings.wireframeThickness,
      opacity: () => settings.opacity
    },
    attributes: {
      position: positionsBuffer,
      stateIndex: stateIndexesBuffer,
      bary: barysBuffer,
      random: randomsBuffer
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
    count: () => positionsBuffer._buffer.byteLength / 4 / 3,
    primitive: 'triangles'
  })
}
