const isIOS = !!navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform)

module.exports = function showBrowserWarning() {
  return new Promise((resolve, reject) => {
    if (isIOS) {
      document.querySelector('.browser-warning.ios').classList.remove('hidden')
      if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'browser-warning', 'ios')
      reject(new Error('Unable to run on this browser or device'))
      return
    }

    const isChrome = !!window.chrome
    if (isChrome) {
      removeWarningEls()
      resolve()
      return
    }

    if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'browser-warning', 'non-chrome')

    const nonChromeWarningEl = document.querySelector('.browser-warning.non-chrome')
    nonChromeWarningEl.classList.remove('hidden')
    nonChromeWarningEl.querySelector('.ok').addEventListener('click', () => {
      nonChromeWarningEl.classList.add('hidden')
      if (!window.IS_DEV) window.ga('send', 'event', 'Load', 'browser-warning', 'proceed')
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
