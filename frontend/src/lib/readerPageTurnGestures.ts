/** 阅读器左右滑翻页手势（EPUB iframe / PDF 共用） */

export const SWIPE_THRESHOLD_PX = 48
export const SWIPE_AXIS_RATIO = 1.2
/** 窄屏/触摸：略抬阈值，减少安卓轻滑误翻页，同时仍易触发 */
export const SWIPE_THRESHOLD_COMPACT_PX = 36
export const SWIPE_AXIS_RATIO_COMPACT = 0.95
export const SWIPE_COOLDOWN_MS = 360
/** 移动中即可判定「横向翻页意图」，用于清掉误触选区 */
export const SWIPE_INTENT_PX = 18

export type PageTurnDirection = 'prev' | 'next'

export interface SwipeTurnResult {
  direction: PageTurnDirection | null
  handled: boolean
}

export interface TouchPoint {
  clientX: number
  clientY: number
}

/** 根据起止点判断是否构成横滑翻页 */
export function resolveHorizontalSwipe(
  start: TouchPoint | null,
  end: TouchPoint | null,
  opts?: { threshold?: number; axisRatio?: number },
): SwipeTurnResult {
  if (!start || !end) return { direction: null, handled: false }
  const threshold = opts?.threshold ?? SWIPE_THRESHOLD_PX
  const axisRatio = opts?.axisRatio ?? SWIPE_AXIS_RATIO
  const dx = end.clientX - start.clientX
  const dy = end.clientY - start.clientY
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  if (absDx < threshold || absDx <= absDy * axisRatio) {
    return { direction: null, handled: false }
  }
  return { direction: dx < 0 ? 'next' : 'prev', handled: true }
}

/** 用过程峰值位移判断横滑（松手点可能回弹，单看起止点会漏判） */
export function resolveHorizontalSwipeByTravel(
  peakDx: number,
  maxAbsDx: number,
  maxAbsDy: number,
  opts?: { threshold?: number; axisRatio?: number },
): SwipeTurnResult {
  const threshold = opts?.threshold ?? SWIPE_THRESHOLD_PX
  const axisRatio = opts?.axisRatio ?? SWIPE_AXIS_RATIO
  if (maxAbsDx < threshold || maxAbsDx <= maxAbsDy * axisRatio) {
    return { direction: null, handled: false }
  }
  // peakDx：过程中绝对值最大的水平位移（带符号）
  return { direction: peakDx < 0 ? 'next' : 'prev', handled: true }
}

export function selectionHasText(sel: Selection | null | undefined): boolean {
  return Boolean(sel?.toString()?.trim())
}

/** 在 document 上绑定 touch 翻页；返回清理函数 */
export function bindSwipePageTurn(
  target: Document | HTMLElement,
  options: {
    onTurn: (dir: PageTurnDirection) => void
    /** 有选区 / 面板打开时返回 true，跳过翻页 */
    shouldIgnore?: () => boolean
    getSelection?: () => Selection | null | undefined
    threshold?: number
    axisRatio?: number
    cooldownMs?: number
  },
): () => void {
  let start: TouchPoint | null = null
  let lastTurnAt = 0
  const cooldown = options.cooldownMs ?? SWIPE_COOLDOWN_MS

  const onStart = (e: TouchEvent) => {
    const t = e.touches?.[0] || e.changedTouches?.[0]
    if (!t) return
    start = { clientX: t.clientX, clientY: t.clientY }
  }

  const onEnd = (e: TouchEvent) => {
    if (options.shouldIgnore?.()) {
      start = null
      return
    }
    const sel = options.getSelection?.()
    if (selectionHasText(sel)) {
      start = null
      return
    }
    const t = e.changedTouches?.[0]
    if (!t || !start) return
    const end = { clientX: t.clientX, clientY: t.clientY }
    const { direction, handled } = resolveHorizontalSwipe(start, end, {
      threshold: options.threshold,
      axisRatio: options.axisRatio,
    })
    start = null
    if (!handled || !direction) return
    const now = Date.now()
    if (now - lastTurnAt < cooldown) return
    lastTurnAt = now
    options.onTurn(direction)
  }

  const onCancel = () => {
    start = null
  }

  const startListener = onStart as EventListener
  const endListener = onEnd as EventListener
  const cancelListener = onCancel as EventListener
  target.addEventListener('touchstart', startListener, { passive: true })
  target.addEventListener('touchend', endListener, { passive: true })
  target.addEventListener('touchcancel', cancelListener, { passive: true })

  return () => {
    target.removeEventListener('touchstart', startListener)
    target.removeEventListener('touchend', endListener)
    target.removeEventListener('touchcancel', cancelListener)
  }
}
