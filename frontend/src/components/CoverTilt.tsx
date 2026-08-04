import { useRef, type MouseEvent, type TouchEvent, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

/**
 * 封面悬浮微交互：克制的 3D 微倾 + 抬升 + 环境光影。
 *
 * 设计要点（对齐纸质书在书桌上被拿起的手感，而非浮夸的卡片特效）：
 * - 倾角很小（默认 5°），只在鼠标移动时轻轻响应，绝不喧宾夺主；
 * - 抬升 / 缩放统一交给 Motion 管理（会在内联 style 上写 transform），
 *   所以不要再指望同一节点上的 CSS `:hover { transform: … }` 生效；
 * - 阴影 / 描边光晕用 CSS 处理（Motion 不接管 box-shadow），两者互不冲突。
 */
const hoverTransition = {
  type: 'spring' as const,
  stiffness: 340,
  damping: 26,
  mass: 0.6,
}

const tapTransition = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 30,
}

const tiltSpringSoft = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 24,
  mass: 0.6,
}

export default function CoverTilt({
  children,
  className,
  maxTilt = 5,
}: {
  children: ReactNode
  className?: string
  maxTilt?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Normalized pointer coordinates [-0.5, 0.5]
  const px = useMotionValue(0)
  const py = useMotionValue(0)

  const sx = useSpring(px, tiltSpringSoft)
  const sy = useSpring(py, tiltSpringSoft)

  const rotateX = useTransform(sy, [-0.5, 0.5], [maxTilt, -maxTilt])
  const rotateY = useTransform(sx, [-0.5, 0.5], [-maxTilt * 1.15, maxTilt * 1.15])

  function onMove(e: MouseEvent | TouchEvent) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    const x = clientX - rect.left
    const y = clientY - rect.top

    px.set(x / rect.width - 0.5)
    py.set(y / rect.height - 0.5)

    el.style.setProperty('--mouse-x', `${x}px`)
    el.style.setProperty('--mouse-y', `${y}px`)
  }

  function onLeave() {
    px.set(0)
    py.set(0)
    if (ref.current) {
      ref.current.style.setProperty('--mouse-x', '-1000px')
      ref.current.style.setProperty('--mouse-y', '-1000px')
    }
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ scale: 1, y: 0 }}
      whileHover={{ scale: 1.045, y: -7, transition: hoverTransition }}
      whileTap={{ scale: 0.975, y: -2, transition: tapTransition }}
      transition={hoverTransition}
      style={{
        rotateX,
        rotateY,
        transformPerspective: 1000,
        transformStyle: 'preserve-3d',
      }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onTouchStart={onMove}
      onTouchMove={onMove}
      onTouchEnd={onLeave}
      onTouchCancel={onLeave}
    >
      {children}
      <div className="parallax-glare" aria-hidden />
      <div className="parallax-sheen" aria-hidden />
    </motion.div>
  )
}
