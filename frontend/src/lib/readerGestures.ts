/** 阅读器：区分「点按翻页」与「划词」 */

export const TAP_MOVE_PX = 8
/** 位移很小却瞬间选出超长文本时，多半是点按误触（PDF 文字层尤甚） */
export const ACCIDENTAL_SELECT_CHARS = 180
/** 手势持续超过该时长：视为有意划选/拖手柄，绝不清选区 */
export const INTENTIONAL_GESTURE_MS = 280

export function clearDomSelection(win: Window | null | undefined = window) {
  try {
    win?.getSelection()?.removeAllRanges()
  } catch {
    /* cross-origin / detached */
  }
}

export function selectionText(win: Window | null | undefined = window): string {
  try {
    return (win?.getSelection()?.toString() || '').replace(/\u00a0/g, ' ').trim()
  } catch {
    return ''
  }
}

/**
 * 是否「点按误触」出的超长选区（应清掉）。
 * - 有明显拖动：不是误触
 * - 手势持续较久（长按、拖手柄扩选）：不是误触
 * - 仅「瞬间点按 + 几乎无位移 + 超长文本」才清
 */
export function isAccidentalTapSelection(
  text: string,
  movePx: number,
  gestureMs?: number,
): boolean {
  const t = text.trim()
  if (!t) return false
  if (movePx >= TAP_MOVE_PX) return false
  if (gestureMs !== undefined && gestureMs >= INTENTIONAL_GESTURE_MS) return false
  return t.length >= ACCIDENTAL_SELECT_CHARS
}

/**
 * 是否像是用户有意划词（可保留选区 / 可弹出功能条）。
 */
export function isIntentionalTextSelection(
  text: string,
  movePx: number,
  gestureMs?: number,
): boolean {
  const t = text.trim()
  if (!t) return false
  return !isAccidentalTapSelection(t, movePx, gestureMs)
}

export function pointerTravel(
  from: { x: number; y: number } | null | undefined,
  toX: number,
  toY: number,
): number {
  if (!from) return 0
  return Math.hypot(toX - from.x, toY - from.y)
}
