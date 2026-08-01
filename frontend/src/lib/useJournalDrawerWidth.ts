import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'

const STORAGE_KEY = 'moyin_journal_width'
const MIN_W = 320
const MAX_W = 720
const DEFAULT_W = 420

function clampWidth(n: number) {
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)))
}

function readStoredWidth(): number {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(raw) && raw >= MIN_W) return clampWidth(raw)
  } catch {
    /* private mode */
  }
  return DEFAULT_W
}

/**
 * 桌面端笔记侧栏宽度：左缘拖拽改宽，写入 localStorage。
 */
export function useJournalDrawerWidth() {
  const [width, setWidth] = useState(readStoredWidth)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width))
    } catch {
      /* private mode */
    }
  }, [width])

  const onResizePointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = width
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    const onMove = (ev: PointerEvent) => {
      // 侧栏贴右：向左拖加宽
      const next = clampWidth(startW + (startX - ev.clientX))
      setWidth(next)
    }
    const onUp = (ev: PointerEvent) => {
      try {
        target.releasePointerCapture(ev.pointerId)
      } catch {
        /* already released */
      }
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }, [width])

  return { width, setWidth, onResizePointerDown, minWidth: MIN_W, maxWidth: MAX_W }
}
