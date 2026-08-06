import { useCallback, useRef } from 'react'

/** 位移超过该值视为滑动，松开后的 click 应忽略 */
export const TAP_GUARD_MOVE_PX = 12

/**
 * 区分「轻点」与「滑动」。
 * 安卓横滑货架后常会合成 click，导致误进书籍详情/阅读页。
 */
export function useTapGuard(movePx = TAP_GUARD_MOVE_PX) {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  /** 滑动结束后短时继续吞掉 click（部分 WebView 会晚到） */
  const suppressUntilRef = useRef(0)

  const onPointerDown = useCallback((e: { clientX: number; clientY: number }) => {
    startRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = false
  }, [])

  const onPointerMove = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const start = startRef.current
      if (!start || movedRef.current) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (dx * dx + dy * dy >= movePx * movePx) {
        movedRef.current = true
        suppressUntilRef.current = Date.now() + 450
      }
    },
    [movePx],
  )

  const onPointerUp = useCallback(() => {
    if (movedRef.current) suppressUntilRef.current = Date.now() + 450
    startRef.current = null
  }, [])

  const onPointerCancel = useCallback(() => {
    if (movedRef.current) suppressUntilRef.current = Date.now() + 450
    startRef.current = null
  }, [])

  const shouldIgnoreTap = useCallback(() => {
    if (movedRef.current) return true
    return Date.now() < suppressUntilRef.current
  }, [])

  /** 包裹 onClick：滑动后忽略 */
  const guardClick = useCallback(
    <E extends { preventDefault?: () => void; stopPropagation?: () => void }>(
      handler: (e: E) => void,
    ) => {
      return (e: E) => {
        if (shouldIgnoreTap()) {
          e.preventDefault?.()
          e.stopPropagation?.()
          movedRef.current = false
          return
        }
        movedRef.current = false
        handler(e)
      }
    },
    [shouldIgnoreTap],
  )

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    shouldIgnoreTap,
    guardClick,
  }
}
