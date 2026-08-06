import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  className?: string
  children: ReactNode
  /** 无障碍标签 */
  ariaLabel?: string
}

/**
 * 移动端横向货架：原生惯性滚动。
 * 手指按住 + 惯性滚动期间暂停子项抖动，停稳后再恢复（避免动量阶段裁切鬼畜）。
 */
export default function HorizontalShelf({ className = '', children, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const clearIdle = () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current)
        idleTimer.current = null
      }
    }

    const pauseJiggle = () => {
      el.classList.add('is-scrolling')
      clearIdle()
    }

    const resumeAfterIdle = (ms: number) => {
      clearIdle()
      idleTimer.current = setTimeout(() => {
        el.classList.remove('is-scrolling')
        idleTimer.current = null
      }, ms)
    }

    const onTouchStart = () => pauseJiggle()
    const onTouchEnd = () => resumeAfterIdle(220)
    const onScroll = () => {
      pauseJiggle()
      resumeAfterIdle(180)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('scroll', onScroll)
      clearIdle()
      el.classList.remove('is-scrolling')
    }
  }, [])

  return (
    <div
      ref={ref}
      className={`h-shelf ${className}`.trim()}
      data-h-scroll=""
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
}
