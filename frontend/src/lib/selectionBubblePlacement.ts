/** 选区气泡：锚点解析与上/下方横条定位（避免遮挡选中文字） */

import type { SelectionAnchor } from './readerConstants'

const PAD = 10
const GAP = 10
/** 苹果式横条默认尺寸 */
export const SELECTION_BAR_W = 340
export const SELECTION_BAR_H = 44
export const SELECTION_BAR_H_WITH_TRANSLATE = 78

/** @deprecated 兼容旧命名 */
export const SELECTION_MENU_W = SELECTION_BAR_W
/** @deprecated 兼容旧命名 */
export const SELECTION_MENU_H = 220

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

/** iframe 内 Range → 顶层窗口屏幕坐标包围盒（供 position:fixed） */
export function rangeToScreenBounds(
  range: Range,
  iframeEl: Element | null | undefined,
): NonNullable<SelectionAnchor['screen']> | null {
  const rects = validRects(range)
  const iframeRect = iframeEl?.getBoundingClientRect()
  const ox = iframeRect?.left || 0
  const oy = iframeRect?.top || 0

  let top = Infinity
  let bottom = -Infinity
  let left = Infinity
  let right = -Infinity

  if (rects.length) {
    for (const r of rects) {
      top = Math.min(top, r.top + oy)
      bottom = Math.max(bottom, r.bottom + oy)
      left = Math.min(left, r.left + ox)
      right = Math.max(right, r.right + ox)
    }
  } else {
    try {
      const rect = range.getBoundingClientRect()
      if (!rect || (!rect.width && !rect.height)) return null
      top = rect.top + oy
      bottom = rect.bottom + oy
      left = rect.left + ox
      right = rect.right + ox
    } catch {
      return null
    }
  }

  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null
  return {
    top,
    bottom,
    left,
    right,
    midX: (left + right) / 2,
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
 * 苹果式横条：优先选区上方居中；上方不够则下方；始终不压住选区。
 * 使用屏幕坐标 + position:fixed。
 */
export function placeSelectionBar(opts: {
  screen: NonNullable<SelectionAnchor['screen']>
  menuW: number
  menuH: number
  viewportW?: number
  viewportH?: number
  safeTop?: number
  safeBottom?: number
}): MenuBox {
  const menuW = opts.menuW
  const menuH = opts.menuH
  const vw = opts.viewportW ?? (typeof window !== 'undefined' ? window.innerWidth : 390)
  const vh = opts.viewportH ?? (typeof window !== 'undefined' ? window.innerHeight : 844)
  const safeTop = opts.safeTop ?? PAD
  const safeBottom = opts.safeBottom ?? PAD
  const { screen } = opts

  let left = screen.midX - menuW / 2
  left = Math.max(PAD, Math.min(left, vw - menuW - PAD))

  const spaceAbove = screen.top - safeTop
  const spaceBelow = vh - safeBottom - screen.bottom

  let top: number
  let placement: MenuPlacement

  // 优先上方；上方放不下整条且下方更宽裕时改下方
  if (spaceAbove >= menuH + GAP || spaceAbove >= spaceBelow) {
    top = screen.top - menuH - GAP
    placement = 'anchored-above'
    if (top < safeTop) {
      top = screen.bottom + GAP
      placement = 'anchored-below'
    }
  } else {
    top = screen.bottom + GAP
    placement = 'anchored-below'
    if (top + menuH > vh - safeBottom) {
      top = Math.max(safeTop, screen.top - menuH - GAP)
      placement = 'anchored-above'
    }
  }

  top = Math.max(safeTop, Math.min(top, vh - menuH - safeBottom))
  return { left, top, placement }
}

/**
 * @deprecated 旧绝对定位；新逻辑用 placeSelectionBar
 */
export function placeSelectionMenu(opts: {
  anchor: SelectionAnchor
  containerW: number
  containerH: number
  menuW?: number
  menuH?: number
}): MenuBox {
  const menuW = opts.menuW ?? SELECTION_BAR_W
  const menuH = opts.menuH ?? SELECTION_BAR_H
  if (opts.anchor.screen) {
    return placeSelectionBar({
      screen: opts.anchor.screen,
      menuW,
      menuH,
      viewportW: opts.containerW,
      viewportH: opts.containerH,
    })
  }
  const selectionCenterX = opts.anchor.x
  const selectionTop = opts.anchor.y
  const selectionBottom = opts.anchor.endY ?? opts.anchor.y + (opts.anchor.height || 20)
  let left = selectionCenterX - menuW / 2
  left = Math.max(PAD, Math.min(left, opts.containerW - menuW - PAD))
  let top = selectionTop - menuH - GAP
  let placement: MenuPlacement = 'anchored-above'
  if (top < PAD) {
    top = selectionBottom + GAP
    placement = 'anchored-below'
    if (top + menuH > opts.containerH - PAD) {
      top = Math.max(PAD, opts.containerH - menuH - PAD)
    }
  }
  return { left, top, placement }
}
