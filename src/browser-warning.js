const isIOS = !!navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform)

module.exports = function showBrowserWarning() {
  return new Promise((resolve, reject) => {
    if (isIOS) {
      document.querySelector('.browser-warning.ios').classList.remove('hidden')
      reject(new Error('Unable to run on this browser or device'))
      return
    }

    const isChrome = !!window.chrome
    if (isChrome) {
      removeWarningEls()
      resolve()
      return
    }

    const nonChromeWarningEl = document.querySelector('.browser-warning.non-chrome')
    nonChromeWarningEl.classList.remove('hidden')
    nonChromeWarningEl.querySelector('.ok').addEventListener('click', () => {
      nonChromeWarningEl.classList.add('hidden')
      setTimeout(() => {
        removeWarningEls()
        resolve()
      }, 500)
    })
  })
  function removeWarningEls() {
    Array.from(document.querySelectorAll('.browser-warning')).forEach(el => el.parentElement.removeChild(el))
  }
}
