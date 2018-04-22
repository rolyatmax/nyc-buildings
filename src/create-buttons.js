const buildingClasses = require('./building-classes')

module.exports = function createButtons (container, settings) {
  const createBtnEl = () => document.createElement('button')
  const buttons = [
    { name: 'built', label: 'Age', el: createBtnEl(), keysHeight: 55 },
    { name: 'height', label: 'Height', el: createBtnEl(), keysHeight: 55 },
    { name: 'class', label: 'Building Class', el: createBtnEl(), keysHeight: 180 }
  ]

  buttons.forEach(({ name, label, el }) => {
    el.innerText = label
    container.appendChild(el)
    el.addEventListener('click', () => {
      if (!window.IS_DEV) window.ga('send', 'event', 'Filter', 'select', name)
      toggleFilter(name)
    })
  })

  const { width: buttonWidth } = buttons[0].el.getBoundingClientRect()
  const arrowEl = container.appendChild(document.createElement('div'))
  arrowEl.classList.add('arrow')
  arrowEl.style.left = (buttonWidth / 2 - 4) + 'px'

  const buildingClassEls = Array.from(document.querySelector('.controls-container .key.class').querySelectorAll('ul li'))

  setupBuildingClassColors()

  function renderButtons (settings) {
    const button = buttons.find(btn => btn.name === settings['colorCodeField'])
    const index = buttons.indexOf(button)
    arrowEl.style.transform = `translateX(${index * buttonWidth}px) rotate(45deg)`
    buttons.forEach(btn => btn.el.classList.remove('active'))
    button.el.classList.add('active')

    const keyEls = Array.from(document.querySelectorAll('.controls-container .key'))
    keyEls.forEach(el => {
      if (el.classList.contains(settings['colorCodeField'])) {
        el.classList.add('active')
      } else {
        el.classList.remove('active')
      }
    })
    const keysEl = document.querySelector('.controls-container .keys')
    keysEl.style.height = `${button.keysHeight}px`

    renderBuildingClassColors()
  }

  function setupBuildingClassColors () {
    buildingClassEls.forEach((li) => {
      const name = li.dataset.classType
      if (!buildingClasses[name].canToggle) {
        li.classList.add('disabled')
        return
      }
      li.addEventListener('click', () => {
        buildingClasses[name].active = !buildingClasses[name].active
        if (!window.IS_DEV) window.ga('send', 'event', 'Filter-BuildingClass', 'select', name)
        renderBuildingClassColors()
      })
    })
  }

  function renderBuildingClassColors () {
    buildingClassEls.forEach((li) => {
      const name = li.dataset.classType
      const { color, active } = buildingClasses[name]
      if (!color) throw new Error(`No color defined for class type: ${name}`)
      if (active) {
        li.classList.add('active')
        li.querySelector('span').style.backgroundColor = `rgb(${color.join(', ')})`
      } else {
        li.classList.remove('active')
        li.querySelector('span').style.backgroundColor = `rgb(255, 255, 255)`
      }
    })
  }

  function toggleFilter (name) {
    settings['colorCodeField'] = name
    renderButtons(settings)
  }

  return renderButtons
}
