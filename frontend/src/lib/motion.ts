import type { Transition, Variants } from 'framer-motion'

/** 墨室动效：顶级阻尼弹性与极平滑 Expo */
export const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1]
export const easeInInk: [number, number, number, number] = [0.4, 0, 1, 1]

export const softSpring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.85,
}

export const chromeSpring: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 38,
  mass: 1.2,
}

export const tiltSpring: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 22,
  mass: 0.7,
}

/** 路由 ink-reveal：深邃的揭开效果（桌面端） */
export const inkRevealVariants: Variants = {
  initial: {
    opacity: 0.72,
    y: 28,
    clipPath: 'inset(0 0 100% 0)',
  },
  animate: {
    opacity: 1,
    y: 0,
    clipPath: 'inset(0 0 0% 0)',
    transition: {
      duration: 0.65,
      ease: easeOutExpo,
      clipPath: { duration: 0.75, ease: easeOutExpo },
    },
  },
  exit: {
    opacity: 0,
    y: -16,
    clipPath: 'inset(18% 0 0 0)',
    transition: { duration: 0.35, ease: easeInInk },
  },
}

/**
 * 移动端页面切换：不用 clipPath 整页裁切。
 * 桌面那套「从底部揭开」在小屏上会让每个页面先空白半秒，AI 伴读等复杂页
 * 还可能和 overflow 叠在一起偶发整页不显示。
 */
export const mobilePageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.16, ease: easeInInk },
  },
}

export const fadeUp: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOutExpo },
  },
}

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
}

/**
 * 卡片/列表项的入场态。
 * 注意：之前这里只写了 `animate`，没有 `initial`—— Framer 找不到对应的
 * 隐藏态，等于直接跳到终态渲染，进场动画完全不可见（"一闪而过"的根因之一）。
 * 现在从上方略带旋转地"落下"，配合父级 stagger 形成陆续落下的观感。
 */
export const staggerItem: Variants = {
  initial: {
    opacity: 0,
    y: 30,
    rotateX: -8,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 300, damping: 26, mass: 0.9 },
  },
}

/** 密集网格（书库大量封面）：更快的错峰间隔，避免几十本书排队落下太久 */
export const gridStaggerContainer: Variants = {
  initial: {},
  animate: {
    transition: { staggerChildren: 0.035, delayChildren: 0.04 },
  },
}

export const modalBackdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.22 } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
}

export const modalCardVariants: Variants = {
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 380, damping: 30, mass: 0.85 },
  },
  exit: {
    opacity: 0,
    y: 12,
    scale: 0.97,
    transition: { duration: 0.18, ease: easeInInk },
  },
}

/** @deprecated 使用 inkRevealVariants */
export const pageVariants = inkRevealVariants
export const pageTransition: Transition = {
  duration: 0.58,
  ease: easeOutExpo,
}
