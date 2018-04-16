module.exports = function createButtons (container, settings) {
  const createBtnEl = () => document.createElement('button')
  const buttons = [
    { name: 'built', label: 'Age', el: createBtnEl() },
    { name: 'zone', label: 'Zone', el: createBtnEl() },
    { name: 'height', label: 'Height', el: createBtnEl() },
    { name: 'class', label: 'Building Class', el: createBtnEl() }
  ]

  buttons.forEach(({ name, label, el }) => {
    el.innerText = label
    container.appendChild(el)
    el.addEventListener('click', () => toggleFilter(name))
  })

  const { width: buttonWidth } = buttons[0].el.getBoundingClientRect()
  const arrowEl = container.appendChild(document.createElement('div'))
  arrowEl.classList.add('arrow')
  arrowEl.style.left = (buttonWidth / 2 - 4) + 'px'

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
  }

  function toggleFilter (name) {
    settings['colorCodeField'] = name
    renderButtons(settings)
  }

  return renderButtons
}
