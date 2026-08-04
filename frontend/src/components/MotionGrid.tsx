import { forwardRef, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { gridStaggerContainer, staggerContainer } from '../lib/motion'

/** 网格 / 横滑书架：子项 stagger 进场（需子组件挂 staggerItem variants） */
const MotionGrid = forwardRef<
  HTMLDivElement,
  { className?: string; children: ReactNode; dense?: boolean; mount?: boolean }
>(function MotionGrid({ className, children, dense = true, mount }, ref) {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    )
  }
  const variants = dense ? gridStaggerContainer : staggerContainer
  if (mount) {
    // 首屏内容：挂载即播放，不等滚入视口（避免"跟随页面一起闪出来"）
    return (
      <motion.div ref={ref} className={className} variants={variants} initial="initial" animate="animate">
        {children}
      </motion.div>
    )
  }
  return (
    <motion.div
      ref={ref}
      className={className}
      variants={variants}
      initial="initial"
      whileInView="animate"
      viewport={{ once: true, margin: '0px 0px -48px 0px', amount: 0.12 }}
    >
      {children}
    </motion.div>
  )
})

export default MotionGrid
