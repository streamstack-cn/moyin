import { useEffect, useRef, type RefObject } from 'react'
import { beginReaderPinch, endReaderPinch, markTouchGestureMulti } from '../lib/readerGestureGate'

export type PinchZoomOptions = {
  enabled?: boolean
  /** 手势开始时读取当前缩放基准（PDF scale / EPUB 字号等） */
  getValue: () => number
  /**
   * 写入最终/过程值。
   * previewOnly 时只在松手调用一次；否则按 step 节流调用。
   */
  setValue: (next: number) => void
  min: number
  max: number
  /** 量化步长（previewOnly 时仅约束最终值） */
  step?: number
  /**
   * 跟手预览：相对手势起点的倍数（1 = 未变）。
   * 建议用 CSS transform，避免每帧重排/重绘。
   */
  onPreview?: (factor: number, originValue: number) => void
  /** true：过程只 preview，松手再 setValue（PDF 更丝滑） */
  previewOnly?: boolean
  onPinchStart?: () => void
  onPinchEnd?: () => void
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function quantize(n: number, step: number) {
  if (step <= 0) return n
  return Math.round(n / step) * step
}

function touchDistance(touches: TouchList) {
  if (touches.length < 2) return 0
  const a = touches[0]
  const b = touches[1]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * 移动端双指缩放：跟手预览 + 松手提交，避免缩放过程中反复重绘。
 */
export function usePinchZoom(
  targetRef: RefObject<HTMLElement | null>,
  {
    enabled = true,
    getValue,
    setValue,
    min,
    max,
    step = 0.05,
    onPreview,
    previewOnly = false,
    onPinchStart,
    onPinchEnd,
  }: PinchZoomOptions,
) {
  const getValueRef = useRef(getValue)
  const setValueRef = useRef(setValue)
  const onPreviewRef = useRef(onPreview)
  const onStartRef = useRef(onPinchStart)
  const onEndRef = useRef(onPinchEnd)
  getValueRef.current = getValue
  setValueRef.current = setValue
  onPreviewRef.current = onPreview
  onStartRef.current = onPinchStart
  onEndRef.current = onPinchEnd

  useEffect(() => {
    const el = targetRef.current
    if (!el || !enabled) return

    let pinching = false
    let startDist = 0
    let origin = 1
    let lastFactor = 1
    let lastSent = Number.NaN
    let active = false
    let raf = 0
    let pendingFactor = 1

    const flushPreview = () => {
      raf = 0
      onPreviewRef.current?.(pendingFactor, origin)
      if (!previewOnly) {
        const next = quantize(clamp(origin * pendingFactor, min, max), step)
        if (Number.isNaN(lastSent) || Math.abs(next - lastSent) >= step * 0.49) {
          lastSent = next
          setValueRef.current(next)
        }
      }
    }

    const schedulePreview = (factor: number) => {
      pendingFactor = factor
      lastFactor = factor
      if (raf) return
      raf = window.requestAnimationFrame(flushPreview)
    }

    const begin = (e: TouchEvent) => {
      if (e.touches.length < 2) return
      markTouchGestureMulti()
      const d = touchDistance(e.touches)
      if (d < 12) return
      if (pinching) {
        // 已在双指中：只更新距离基准，避免 origin 被重置导致跳动
        if (e.cancelable) e.preventDefault()
        return
      }
      pinching = true
      active = true
      startDist = d
      origin = getValueRef.current()
      lastFactor = 1
      lastSent = origin
      beginReaderPinch()
      onStartRef.current?.()
      schedulePreview(1)
      if (e.cancelable) e.preventDefault()
    }

    const move = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        markTouchGestureMulti()
        if (!pinching) begin(e)
      }
      if (!pinching) return
      if (e.touches.length < 2 || startDist < 12) return
      if (e.cancelable) e.preventDefault()
      const factor = touchDistance(e.touches) / startDist
      // 轻微阻尼，末端更稳
      const eased = 1 + (factor - 1) * 1.02
      schedulePreview(eased)
    }

    const end = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        markTouchGestureMulti()
        return
      }
      if (!pinching) return
      pinching = false
      if (raf) {
        window.cancelAnimationFrame(raf)
        raf = 0
      }
      const finalValue = quantize(clamp(origin * lastFactor, min, max), step)
      setValueRef.current(finalValue)
      startDist = 0
      lastFactor = 1
      if (active) {
        active = false
        endReaderPinch()
        onEndRef.current?.()
      }
    }

    el.addEventListener('touchstart', begin, { passive: false, capture: true })
    el.addEventListener('touchmove', move, { passive: false, capture: true })
    el.addEventListener('touchend', end, { capture: true })
    el.addEventListener('touchcancel', end, { capture: true })

    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      if (active) endReaderPinch()
      el.removeEventListener('touchstart', begin, true)
      el.removeEventListener('touchmove', move, true)
      el.removeEventListener('touchend', end, true)
      el.removeEventListener('touchcancel', end, true)
    }
  }, [targetRef, enabled, min, max, step, previewOnly])
}
