import { useEffect, useRef, type RefObject } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { exitReader } from '../lib/exitReader'

/**
 * 移动端阅读页：左缘右滑 → 与顶栏返回相同（exitReader）。
 * 在左缘横滑过程中 preventDefault，尽量抢走 iOS 系统返回手势，避免整页重载。
 */
export function useReaderExitBackGesture(
  shellRef: RefObject<HTMLElement | null>,
  navigate: NavigateFunction,
  enabled: boolean,
) {
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!enabled) return
    const el = shellRef.current
    if (!el) return

    const EDGE_PX = 28
    const THRESHOLD = 56
    let startX = 0
    let startY = 0
    let tracking = false
    let fromEdge = false
    let stole = false

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      startX = t.clientX
      startY = t.clientY
      fromEdge = startX <= EDGE_PX
      tracking = fromEdge
      stole = false
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking || !fromEdge) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (dx > 10 && Math.abs(dx) > Math.abs(dy) * 0.85) {
        stole = true
        if (e.cancelable) e.preventDefault()
      }
    }

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      if (!fromEdge) return
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (dx >= THRESHOLD && Math.abs(dx) > Math.abs(dy) * 0.9) {
        exitReader(navigateRef.current)
        return
      }
      if (stole && e.cancelable) e.preventDefault()
    }

    const onCancel = () => {
      tracking = false
      stole = false
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: false })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [enabled, shellRef])
}
