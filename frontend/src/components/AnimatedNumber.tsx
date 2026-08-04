import { useEffect, useRef } from 'react'
import { animate, useReducedMotion } from 'framer-motion'

/**
 * 数字滚动动效：书库统计条（馆藏 318 / 收藏 2 …）从旧值缓动滚到新值，
 * 而不是数字生硬地跳变，配合整体「高级动画」的诉求。
 * value 为 null/undefined 时显示占位符 "—"（数据尚未加载完成）。
 */
export default function AnimatedNumber({ value }: { value: number | null | undefined }) {
  const reduceMotion = useReducedMotion()
  const spanRef = useRef<HTMLSpanElement>(null)
  const prevRef = useRef<number | null>(null)

  useEffect(() => {
    if (value == null || !spanRef.current) return
    const from = prevRef.current ?? 0
    if (reduceMotion || from === value) {
      spanRef.current.textContent = String(value)
      prevRef.current = value
      return
    }
    // 注意：prevRef 要等动画真正播完（onComplete）再更新，而不是启动时就更新——
    // 否则 React 18 StrictMode 开发模式下 effect 的「挂载→清理→再挂载」会让第二次
    // 直接读到已经写好的目标值，导致动画被跳过，数字看起来像是没有动效。
    const controls = animate(from, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(latest) {
        if (spanRef.current) spanRef.current.textContent = String(Math.round(latest))
      },
      onComplete() {
        prevRef.current = value
      },
    })
    return () => controls.stop()
  }, [value, reduceMotion])

  if (value == null) return <span>—</span>
  return <span ref={spanRef}>{prevRef.current ?? 0}</span>
}
