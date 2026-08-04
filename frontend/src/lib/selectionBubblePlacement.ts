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
 * 指针优先改为选区中心居中优先：默认出现在选中文字上方居中；
 * 如果上方空间不够则翻到下方居中；如果下方也不够，则约束在视口内。
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

  // 计算选区中心点
  // 如果有多行，anchor.x 和 anchor.y 通常是第一行的。
  // 为了美观，我们采用 anchor.x 减去可能的一半宽度？
  // 注意：在 rangeToSelectionAnchor 中，anchor.x 已经是第一行的 center (left + width/2)
  const selectionCenterX = anchor.x
  const selectionTop = anchor.y
  const selectionBottom = anchor.y + (anchor.height || 20)

  // 默认水平居中对齐选中文字
  let left = selectionCenterX - menuW / 2
  // 确保不溢出左右边界
  left = Math.max(PAD, Math.min(left, containerW - menuW - PAD))

  // 默认出现在选中文字的上方
  let top = selectionTop - menuH - GAP
  let placement: MenuPlacement = 'anchored-above'

  // 如果上方空间不够，则尝试放到下方
  if (top < PAD) {
    top = selectionBottom + GAP
    placement = 'anchored-below'
    
    // 如果下方也不够，则强制约束在视口内（贴近顶部或底部）
    if (top + menuH > containerH - PAD) {
      top = Math.max(PAD, containerH - menuH - PAD)
    }
  }

  return { left, top, placement }
}
