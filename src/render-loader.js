module.exports = function createLoaderRenderer(element) {
  const loadedEl = element.querySelector('.loaded')
  let lowerBound = 0.05
  let curT = 0

  window.requestAnimationFrame(() => {
    document.querySelector('.title h1').classList.remove('hidden')
    element.classList.remove('hidden')
  })

  let lastT = curT
  setTimeout(function loop() {
    if (curT < 1) setTimeout(loop, 1000)
    if (lastT === curT) {
      console.log('updating progress bar lowerBound!')
      lowerBound += Math.random() * 0.02
      lowerBound = Math.min(lowerBound, 0.95)
      render(curT)
    }
    lastT = curT
  }, 1000)

  return { render, remove }

  function render(t) {
    curT = t
    t *= (1 - lowerBound)
    t += lowerBound
    let perc = (t * 100 | 0)
    loadedEl.style.width = perc + '%'
  }

  function remove() {
    element.style.opacity = 0
    setTimeout(() => element.parentElement.removeChild(element), 800)
  }

  // return regl({
  //   vert: glsl`
  //     attribute vec3 position;

  //     varying vec4 fragColor;
  //     varying float vOpacity;

  //     uniform mat4 projection;
  //     uniform mat4 view;

  //     void main() {
  //       vOpacity = 1.0;

  //       vec3 color = vec3(0.15);

  //       gl_PointSize = 1.0;
  //       gl_Position = projection * view * vec4(position.xyz, 1);
  //       float opacity = 0.2;
  //       fragColor = vec4(color, opacity);
  //     }
  //   `,
  //   frag: glsl`
  //     precision highp float;
  //     varying vec4 fragColor;
  //     varying float vOpacity;

  //     void main() {
  //       gl_FragColor = fragColor;
  //       gl_FragColor.a *= vOpacity;
  //     }
  //   `,
  //   attributes: {
  //     position: positionsBuffer,
  //     bary: barysBuffer,
  //     random: randomsBuffer
  //   },
  //   blend: {
  //     enable: true,
  //     func: {
  //       srcRGB: 'src alpha',
  //       srcAlpha: 1,
  //       dstRGB: 'one minus src alpha',
  //       dstAlpha: 1
  //     },
  //     equation: {
  //       rgb: 'add',
  //       alpha: 'add'
  //     }
  //   },
  //   count: () => positionsBuffer._buffer.byteLength / 4 / 3,
  //   primitive: 'triangles'
  // })
}
