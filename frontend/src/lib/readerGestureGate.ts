/**
 * 阅读手势闸门：双指缩放进行中 / 刚结束的短冷却期内，禁止翻页与点按切换工具栏。
 * （避免 pinch 松手时被中部滑动层 / 边缘热区 / touchend 误判为横滑翻页）
 */

let pinchDepth = 0
let blockUntil = 0

const COOLDOWN_MS = 420

export function beginReaderPinch() {
  pinchDepth += 1
  blockUntil = Date.now() + COOLDOWN_MS
}

export function endReaderPinch() {
  pinchDepth = Math.max(0, pinchDepth - 1)
  blockUntil = Date.now() + COOLDOWN_MS
}

/** 缩放中，或松手后的冷却期内 */
export function isReaderPinchBlocking(): boolean {
  return pinchDepth > 0 || Date.now() < blockUntil
}

/** 标记「本段触摸曾出现多指」，用于各 touchend 路径自行忽略 */
export function markTouchGestureMulti() {
  blockUntil = Math.max(blockUntil, Date.now() + COOLDOWN_MS)
}
