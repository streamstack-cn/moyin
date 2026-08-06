/** 阅读页与主界面同壳共存：从 /read 返回时派发，供首页等静默刷新 */

export const MAIN_RESUME_EVENT = 'moyin:main-resume'

export function emitMainResume() {
  window.dispatchEvent(new Event(MAIN_RESUME_EVENT))
}

export function onMainResume(handler: () => void): () => void {
  window.addEventListener(MAIN_RESUME_EVENT, handler)
  return () => window.removeEventListener(MAIN_RESUME_EVENT, handler)
}
