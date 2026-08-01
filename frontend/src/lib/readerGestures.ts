/** 阅读器：区分「点按翻页」与「划词」 */

export const TAP_MOVE_PX = 8
/** 位移很小却选出超长文本时，多半是点按误触（PDF 文字层尤甚） */
export const ACCIDENTAL_SELECT_CHARS = 180

export function clearDomSelection(win: Window | null | undefined = window) {
  try {
    win?.getSelection()?.removeAllRanges()
  } catch {
    /* cross-origin / detached */
  }
}

export function selectionText(win: Window | null | undefined = window): string {
  try {
    return win?.getSelection()?.toString().trim() || ''
  } catch {
    return ''
  }
}

/**
 * 是否像是用户有意划词。
 * - 有明显拖动：视为划词
 * - 几乎无拖动但选中很短（双击选词等）：允许
 * - 几乎无拖动却选出大段：视为误触，应清掉
 */
export function isIntentionalTextSelection(text: string, movePx: number): boolean {
  const t = text.trim()
  if (!t) return false
  if (movePx >= TAP_MOVE_PX) return true
  if (t.length >= ACCIDENTAL_SELECT_CHARS) return false
  return t.length >= 1
}

export function pointerTravel(
  from: { x: number; y: number } | null | undefined,
  toX: number,
  toY: number,
): number {
  if (!from) return 0
  return Math.hypot(toX - from.x, toY - from.y)
}
