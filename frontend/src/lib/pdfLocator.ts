/**
 * PDF 选区定位（对齐 Obsidian / PDF++）：
 *   pdf:#page=12&selection=beginIndex,beginOffset,endIndex,endOffset
 * 索引对应 pdf.js TextLayer 的 textDivs / textContent items，缩放后可重算几何。
 */

import { rangeToSelectionAnchor } from './selectionBubblePlacement'

export interface PdfSelectionLocator {
  page: number
  beginIndex: number
  beginOffset: number
  endIndex: number
  endOffset: number
}

export function encodePdfLocator(sel: PdfSelectionLocator): string {
  const { page, beginIndex, beginOffset, endIndex, endOffset } = sel
  return `pdf:#page=${page}&selection=${beginIndex},${beginOffset},${endIndex},${endOffset}`
}

export function parsePdfLocator(raw: string): PdfSelectionLocator | null {
  if (!raw || !raw.startsWith('pdf:')) return null
  const q = raw.slice(4).replace(/^#/, '')
  const params = new URLSearchParams(q)
  const page = Number.parseInt(params.get('page') || '', 10)
  const parts = (params.get('selection') || '').split(',').map((x) => Number.parseInt(x, 10))
  if (!Number.isFinite(page) || page < 1 || parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null
  }
  let [beginIndex, beginOffset, endIndex, endOffset] = parts
  if (
    endIndex < beginIndex ||
    (endIndex === beginIndex && endOffset < beginOffset)
  ) {
    ;[beginIndex, beginOffset, endIndex, endOffset] = [endIndex, endOffset, beginIndex, beginOffset]
  }
  return { page, beginIndex, beginOffset, endIndex, endOffset }
}

export function isPdfLocator(raw: string): boolean {
  return Boolean(parsePdfLocator(raw))
}

/** 从 PDF locator / `pdf:#page=N` / 纯页码字符串解析起始页（用于深链跳转） */
export function pdfTargetPage(raw: string): number | null {
  if (!raw?.trim()) return null
  const loc = parsePdfLocator(raw)
  if (loc) return loc.page
  const trimmed = raw.trim()
  if (trimmed.startsWith('pdf:')) {
    const q = trimmed.slice(4).replace(/^#/, '')
    const page = Number.parseInt(new URLSearchParams(q).get('page') || '', 10)
    return Number.isFinite(page) && page >= 1 ? page : null
  }
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10)
    return n >= 1 ? n : null
  }
  return null
}

function resolveTextNodeOffset(
  container: Node,
  offset: number,
): { node: Text; offset: number } | null {
  if (container.nodeType === Node.TEXT_NODE) {
    return { node: container as Text, offset }
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    const el = container as Element
    if (offset < el.childNodes.length) {
      const child = el.childNodes[offset]
      if (child.nodeType === Node.TEXT_NODE) {
        return { node: child as Text, offset: 0 }
      }
      const text = child.textContent ? (child.firstChild as Text | null) : null
      if (text && text.nodeType === Node.TEXT_NODE) {
        return { node: text, offset: 0 }
      }
    }
    if (offset > 0 && offset - 1 < el.childNodes.length) {
      const child = el.childNodes[offset - 1]
      const text =
        child.nodeType === Node.TEXT_NODE
          ? (child as Text)
          : (child.firstChild as Text | null)
      if (text && text.nodeType === Node.TEXT_NODE) {
        return { node: text, offset: text.textContent?.length || 0 }
      }
    }
    const walk = el.querySelector('*') ? null : (el.firstChild as Text | null)
    if (walk && walk.nodeType === Node.TEXT_NODE) {
      return { node: walk, offset: Math.min(offset, walk.textContent?.length || 0) }
    }
  }
  return null
}

function findDivForNode(node: Node, textDivs: HTMLElement[]): { index: number; textNode: Text } | null {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const idx = textDivs.indexOf(cur as HTMLElement)
      if (idx >= 0) {
        const textNode =
          cur.firstChild && cur.firstChild.nodeType === Node.TEXT_NODE
            ? (cur.firstChild as Text)
            : null
        if (textNode) return { index: idx, textNode }
      }
    }
    cur = cur.parentNode
  }
  return null
}

/** 把当前 window Selection 映射为 PDF locator（须落在 textLayer 内） */
export function selectionToPdfLocator(
  textLayerEl: HTMLElement,
  textDivs: HTMLElement[],
  page: number,
): { locator: string; text: string; range: Range } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!textLayerEl.contains(range.commonAncestorContainer)) return null

  const startHit = findDivForNode(range.startContainer, textDivs)
  const endHit = findDivForNode(range.endContainer, textDivs)
  if (!startHit || !endHit) return null

  let beginOffset = 0
  let endOffset = 0
  if (range.startContainer === startHit.textNode || startHit.textNode.contains(range.startContainer)) {
    beginOffset = range.startContainer === startHit.textNode ? range.startOffset : 0
  } else {
    const resolved = resolveTextNodeOffset(range.startContainer, range.startOffset)
    beginOffset = resolved && resolved.node === startHit.textNode ? resolved.offset : 0
  }
  if (range.endContainer === endHit.textNode || endHit.textNode.contains(range.endContainer)) {
    endOffset = range.endContainer === endHit.textNode ? range.endOffset : endHit.textNode.textContent?.length || 0
  } else {
    const resolved = resolveTextNodeOffset(range.endContainer, range.endOffset)
    endOffset =
      resolved && resolved.node === endHit.textNode
        ? resolved.offset
        : endHit.textNode.textContent?.length || 0
  }

  const startLen = startHit.textNode.textContent?.length || 0
  const endLen = endHit.textNode.textContent?.length || 0
  beginOffset = Math.max(0, Math.min(beginOffset, startLen))
  endOffset = Math.max(0, Math.min(endOffset, endLen))

  const text = sel.toString().replace(/\u00a0/g, ' ').trim()
  if (!text) return null

  const locator = encodePdfLocator({
    page,
    beginIndex: startHit.index,
    beginOffset,
    endIndex: endHit.index,
    endOffset,
  })
  return { locator, text, range: range.cloneRange() }
}

/** 由 locator 构建 Range（用于高亮矩形） */
export function locatorToRange(
  loc: PdfSelectionLocator,
  textDivs: HTMLElement[],
): Range | null {
  const startDiv = textDivs[loc.beginIndex]
  const endDiv = textDivs[loc.endIndex]
  if (!startDiv || !endDiv) return null
  const startText =
    startDiv.firstChild && startDiv.firstChild.nodeType === Node.TEXT_NODE
      ? (startDiv.firstChild as Text)
      : null
  const endText =
    endDiv.firstChild && endDiv.firstChild.nodeType === Node.TEXT_NODE
      ? (endDiv.firstChild as Text)
      : null
  if (!startText || !endText) return null
  const range = document.createRange()
  try {
    range.setStart(startText, Math.max(0, Math.min(loc.beginOffset, startText.length)))
    range.setEnd(endText, Math.max(0, Math.min(loc.endOffset, endText.length)))
  } catch {
    return null
  }
  return range
}

export interface RelativeRect {
  left: number
  top: number
  width: number
  height: number
}

/** 相对 pageEl 的高亮矩形 */
export function locatorToRelativeRects(
  loc: PdfSelectionLocator,
  textDivs: HTMLElement[],
  pageEl: HTMLElement,
): RelativeRect[] {
  const range = locatorToRange(loc, textDivs)
  if (!range) return []
  const pageBox = pageEl.getBoundingClientRect()
  const out: RelativeRect[] = []
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue
    out.push({
      left: r.left - pageBox.left,
      top: r.top - pageBox.top,
      width: r.width,
      height: r.height,
    })
  }
  return out
}

export function rangeToAnchor(
  range: Range,
  viewportEl: HTMLElement,
): { x: number; y: number; height: number; endX?: number; endY?: number } | null {
  const box = viewportEl.getBoundingClientRect()
  return rangeToSelectionAnchor(range, {
    left: -box.left,
    top: -box.top,
    scrollLeft: viewportEl.scrollLeft,
    scrollTop: viewportEl.scrollTop,
  })
}
