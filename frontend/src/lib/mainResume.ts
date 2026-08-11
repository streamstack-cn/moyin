/** 阅读页与主界面同壳共存：从 /read 返回时派发，供首页等静默刷新 */

export const MAIN_RESUME_EVENT = 'moyin:main-resume'

/**
 * 退出阅读后自愈移动端顶栏 / 安全区。
 * iOS 在主层曾用 display:none 藏起再显示时，fixed 顶栏与 env(safe-area-inset-*)
 * 偶发不重算，表现为顶部一条黑块、问候语等被挡住。
 */
export function healMainChromeAfterReader() {
  try {
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  } catch {
    /* ignore */
  }

  const run = () => {
    const shell = document.querySelector('.app-shell')
    const topbar = document.querySelector('.mobile-topbar')
    const main = document.querySelector('.main-area')

    if (shell instanceof HTMLElement) {
      // 轻推 layout，迫使安全区与 fixed 顶栏重新参与计算
      const pad = shell.style.paddingTop
      shell.style.paddingTop = '0.01px'
      void shell.offsetHeight
      shell.style.paddingTop = pad
    }
    if (topbar instanceof HTMLElement) {
      void topbar.offsetHeight
      topbar.classList.remove('is-chrome-healing')
      // 强制一次合成刷新，避免 backdrop-filter 采到黑底
      void topbar.offsetWidth
      topbar.classList.add('is-chrome-healing')
      requestAnimationFrame(() => topbar.classList.remove('is-chrome-healing'))
    }
    if (main instanceof HTMLElement && main.scrollTop < 0) {
      main.scrollTop = 0
    }
  }

  requestAnimationFrame(() => {
    run()
    requestAnimationFrame(run)
    // 地址栏收展后再补一次
    window.setTimeout(run, 120)
    window.setTimeout(run, 360)
  })
}

export function emitMainResume() {
  healMainChromeAfterReader()
  window.dispatchEvent(new Event(MAIN_RESUME_EVENT))
}

export function onMainResume(handler: () => void): () => void {
  window.addEventListener(MAIN_RESUME_EVENT, handler)
  return () => window.removeEventListener(MAIN_RESUME_EVENT, handler)
}
