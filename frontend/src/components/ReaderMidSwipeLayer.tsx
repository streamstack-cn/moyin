import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isReaderPinchBlocking, markTouchGestureMulti } from '../lib/readerGestureGate'
import {
  resolveHorizontalSwipeByTravel,
  SWIPE_AXIS_RATIO_COMPACT,
  SWIPE_INTENT_PX,
  SWIPE_THRESHOLD_COMPACT_PX,
} from '../lib/readerPageTurnGestures'

export interface ReaderMidSwipeLayerProps {
  onPrev: () => void
  onNext: () => void
  /** 轻点中部（未构成横滑） */
  onTap?: () => void
  /** 长按：让出中部给划词 */
  onLongPressSelect?: () => void
  longPressMs?: number
  className?: string
}

/**
 * 移动端阅读区中部滑动层：盖在正文之上，保证横滑一定能翻页。
 * （PDF 文字层 / EPUB iframe 会吞掉触摸，外层监听经常收不到。）
 * 多指缩放时整段手势作废，避免松手误翻页。
 */
export default function ReaderMidSwipeLayer({
  onPrev,
  onNext,
  onTap,
  onLongPressSelect,
  longPressMs = 380,
  className = '',
}: ReaderMidSwipeLayerProps) {
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null)
  const peakRef = useRef({ maxAbsDx: 0, maxAbsDy: 0, peakDx: 0 })
  const longTimerRef = useRef(0)
  const longFiredRef = useRef(false)
  const turnedRef = useRef(false)
  const pointersRef = useRef(new Set<number>())
  /** 本段手势一旦出现第二指，直到全部抬起都禁止翻页/点按 */
  const spoiledRef = useRef(false)

  const clearLong = () => {
    if (longTimerRef.current) {
      window.clearTimeout(longTimerRef.current)
      longTimerRef.current = 0
    }
  }

  const spoil = () => {
    spoiledRef.current = true
    markTouchGestureMulti()
    startRef.current = null
    clearLong()
    longFiredRef.current = false
    turnedRef.current = false
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (isReaderPinchBlocking()) {
      spoil()
      return
    }
    pointersRef.current.add(e.pointerId)
    if (pointersRef.current.size >= 2) {
      spoil()
      return
    }
    spoiledRef.current = false
    e.currentTarget.setPointerCapture?.(e.pointerId)
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    peakRef.current = { maxAbsDx: 0, maxAbsDy: 0, peakDx: 0 }
    longFiredRef.current = false
    turnedRef.current = false
    clearLong()
    longTimerRef.current = window.setTimeout(() => {
      if (spoiledRef.current || isReaderPinchBlocking()) return
      longFiredRef.current = true
      onLongPressSelect?.()
    }, longPressMs)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (isReaderPinchBlocking() || pointersRef.current.size >= 2) {
      spoil()
      return
    }
    if (spoiledRef.current) return
    const start = startRef.current
    if (!start || start.id !== e.pointerId) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    const peak = peakRef.current
    peak.maxAbsDx = Math.max(peak.maxAbsDx, absDx)
    peak.maxAbsDy = Math.max(peak.maxAbsDy, absDy)
    if (absDx >= Math.abs(peak.peakDx)) peak.peakDx = dx
    if (peak.maxAbsDx >= SWIPE_INTENT_PX || peak.maxAbsDy >= SWIPE_INTENT_PX) {
      clearLong()
    }
  }

  const finish = (e: ReactPointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    const spoiled = spoiledRef.current || isReaderPinchBlocking()
    if (pointersRef.current.size === 0) {
      // 等全部手指抬起后再清 spoiled，避免最后一只手指的 up 误翻页
      const wasSpoiled = spoiledRef.current
      spoiledRef.current = false
      if (wasSpoiled || spoiled) {
        startRef.current = null
        clearLong()
        return
      }
    } else if (spoiled) {
      startRef.current = null
      clearLong()
      return
    }

    const start = startRef.current
    if (!start || start.id !== e.pointerId) return
    startRef.current = null
    clearLong()
    if (longFiredRef.current || turnedRef.current || isReaderPinchBlocking()) return

    const { maxAbsDx, maxAbsDy, peakDx } = peakRef.current
    const swipe = resolveHorizontalSwipeByTravel(peakDx, maxAbsDx, maxAbsDy, {
      threshold: SWIPE_THRESHOLD_COMPACT_PX,
      axisRatio: SWIPE_AXIS_RATIO_COMPACT,
    })
    if (swipe.handled && swipe.direction) {
      turnedRef.current = true
      if (swipe.direction === 'next') onNext()
      else onPrev()
      return
    }

    if (maxAbsDx < 12 && maxAbsDy < 12) {
      onTap?.()
    }
  }

  return (
    <div
      className={`reader-mid-swipe ${className}`.trim()}
      aria-hidden
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  )
}
