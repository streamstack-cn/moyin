import type { NavigateFunction } from 'react-router-dom'

/** 从阅读页退出：优先 history.back（保留下方冻结的主界面），否则落到首页 */
export function exitReader(navigate: NavigateFunction) {
  try {
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1)
      return
    }
  } catch {
    /* private mode / non-RR history */
  }
  if (window.history.length > 1) {
    navigate(-1)
    return
  }
  navigate('/', { replace: true })
}
