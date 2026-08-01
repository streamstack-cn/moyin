/** 选区气泡：锚点解析与指针右侧优先定位（避免遮挡选中文字） */

import type { SelectionAnchor } from './readerConstants'

const PAD = 12
const GAP = 12
/** 菜单默认尺寸估算（含笔记展开余量的保守高度） */
export const SELECTION_MENU_W = 220
export const SELECTION_MENU_H = 280

export type MenuPlacement = 'fallback' | 'anchored' | 'anchored-below' | 'anchored-above'

export interface MenuBox {
  left: number
  top: number
  placement: MenuPlacement
}

/** 视口坐标系下的矩形偏移（iframe/viewport → 阅读容器） */
export interface ViewportOffset {
  left: number
  top: number
  scrollLeft?: number
  scrollTop?: number
}

function validRects(range: Range): DOMRect[] {
  return Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
}

/**
 * 从 Range 生成相对阅读视口的 SelectionAnchor。
 * x/y/height：首块（兼容旧逻辑）；endX/endY：末块右下角（推荐锚点）。
 */
export function rangeToSelectionAnchor(range: Range, offset: ViewportOffset): SelectionAnchor | null {
  const rects = validRects(range)
  if (!rects.length) {
    try {
      const rect = range.getBoundingClientRect()
      if (!rect || (!rect.width && !rect.height)) return null
      const ox = offset.left + (offset.scrollLeft || 0)
      const oy = offset.top + (offset.scrollTop || 0)
      return {
        x: rect.left + rect.width / 2 + ox,
        y: rect.top + oy,
        height: rect.height || 18,
        endX: rect.right + ox,
        endY: rect.bottom + oy,
      }
    } catch {
      return null
    }
  }
  const first = rects[0]
  const last = rects[rects.length - 1]
  const ox = offset.left + (offset.scrollLeft || 0)
  const oy = offset.top + (offset.scrollTop || 0)
  return {
    x: first.left + first.width / 2 + ox,
    y: first.top + oy,
    height: first.height || 18,
    endX: last.right + ox,
    endY: last.bottom + oy,
  }
}

/** 指针相对阅读视口的坐标 */
export function pointerToViewport(
  clientX: number,
  clientY: number,
  wrapRect: DOMRect | undefined,
  scrollLeft = 0,
  scrollTop = 0,
): { x: number; y: number } | null {
  if (!wrapRect) return null
  return {
    x: clientX - wrapRect.left + scrollLeft,
    y: clientY - wrapRect.top + scrollTop,
  }
}

/** 合并指针坐标到锚点 */
export function withPointer(
  anchor: SelectionAnchor | null,
  pointer: { x: number; y: number } | null | undefined,
): SelectionAnchor | null {
  if (!anchor) return null
  if (!pointer) return anchor
  return { ...anchor, pointerX: pointer.x, pointerY: pointer.y }
}

/**
 * 指针右侧优先：默认出现在松手点右侧，纵向贴近指针；
 * 右侧不够则翻到左侧；上下夹边，避免挡住刚选中的文字。
 * 锚点优先：pointer → end → 旧 x/y。
 */
export function placeSelectionMenu(opts: {
  anchor: SelectionAnchor
  containerW: number
  containerH: number
  menuW?: number
  menuH?: number
}): MenuBox {
  const menuW = opts.menuW ?? SELECTION_MENU_W
  const menuH = opts.menuH ?? SELECTION_MENU_H
  const { containerW, containerH, anchor } = opts

  const ax =
    anchor.pointerX != null ? anchor.pointerX : anchor.endX != null ? anchor.endX : anchor.x
  const ay =
    anchor.pointerY != null
      ? anchor.pointerY
      : anchor.endY != null
        ? anchor.endY
        : anchor.y + (anchor.height || 0)

  let left = ax + GAP
  let placement: MenuPlacement = 'anchored'

  // 右侧不够：翻到指针左侧
  if (left + menuW > containerW - PAD) {
    left = ax - menuW - GAP
  }
  left = Math.max(PAD, Math.min(left, containerW - menuW - PAD))

  // 纵向贴近指针略偏上，减少盖住指针下方续选区域
  let top = ay - 28
  if (top + menuH > containerH - PAD) {
    top = containerH - menuH - PAD
    placement = 'anchored-above'
  }
  if (top < PAD) {
    top = PAD
    placement = 'anchored-below'
  }
  top = Math.max(PAD, Math.min(top, Math.max(PAD, containerH - menuH - PAD)))

  return { left, top, placement }
}
