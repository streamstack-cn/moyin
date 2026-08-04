import type { MouseEvent } from 'react'

/**
 * 光标追踪光晕：鼠标移动时把指针相对坐标写进 CSS 变量 --glow-x / --glow-y，
 * 配合 index.css 里 .home-search-field / .search-box 的 radial-gradient ::before
 * 做出「极光跟随光标」的高级输入框效果（uiverse 风格）。
 * 用一个通用函数复用，避免每个页面各写一遍。
 */
export function trackGlow(e: MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--glow-x', `${e.clientX - rect.left}px`)
  e.currentTarget.style.setProperty('--glow-y', `${e.clientY - rect.top}px`)
}
