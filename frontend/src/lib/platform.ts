/** 触控 iPhone / iPod / iPad（含 iPadOS 桌面网站伪装） */
export function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPod|iPad/i.test(ua)) return true
  // iPadOS 13+ 常伪装成 Macintosh，但带触控点
  const touchPoints = navigator.maxTouchPoints || 0
  return touchPoints > 1 && /Macintosh/i.test(ua)
}
