import { useEffect, type RefObject } from 'react'

/**
 * 按实际顶/底栏高度写入 CSS 变量，正文区避开遮挡。
 * 工具栏隐藏时仍保留占位，避免 EPUB resize 导致内容跳动。
 */
export function useReaderChromeInset(shellRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const top = shell.querySelector('.reader-topbar') as HTMLElement | null
    const bottom = shell.querySelector('.reader-bottombar') as HTMLElement | null

    const apply = () => {
      const th = Math.max(top?.offsetHeight ?? 0, 56)
      const bh = Math.max(bottom?.offsetHeight ?? 0, 56)
      shell.style.setProperty('--reader-chrome-top', `${th}px`)
      shell.style.setProperty('--reader-chrome-bottom', `${bh}px`)
    }

    apply()
    const ro = new ResizeObserver(apply)
    if (top) ro.observe(top)
    if (bottom) ro.observe(bottom)
    window.addEventListener('resize', apply)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [shellRef])
}
