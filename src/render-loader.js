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
}
