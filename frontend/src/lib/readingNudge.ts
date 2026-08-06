/** 已读一段、却卡在「快读完」之前：超过该天数未再打开则提示「请读完我」 */
export const FINISH_NUDGE_IDLE_DAYS = 7
/** 进度下限（含）：再浅不算「认真在读」 */
export const FINISH_NUDGE_MIN_PERCENT = 15
/** 进度上限（含）：再深接近尾声，不催完读 */
export const FINISH_NUDGE_MAX_PERCENT = 90

const DAY_MS = 24 * 60 * 60 * 1000
const IDLE_MS = FINISH_NUDGE_IDLE_DAYS * DAY_MS

/** 闲置越久，抖动越勤（最高档仍克制） */
export type FinishNudgeIntensity = 'low' | 'mid' | 'high'

/**
 * 继续阅读卡片：读到 15%~90%，且超过一周没打开 → 提示请读完我。
 * reading_percent 为 0~100。
 */
export function shouldNudgeFinishReading(book: {
  reading_percent: number
  last_read_at: string | null | undefined
}): boolean {
  const pct = Number(book.reading_percent) || 0
  if (pct < FINISH_NUDGE_MIN_PERCENT || pct > FINISH_NUDGE_MAX_PERCENT) return false
  const raw = book.last_read_at
  if (!raw) return false
  const t = new Date(raw).getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() - t >= IDLE_MS
}

/** 闲置天数，用于副文案 */
export function idleDaysSinceLastRead(lastReadAt: string | null | undefined): number {
  if (!lastReadAt) return 0
  const t = new Date(lastReadAt).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS))
}

/**
 * 1–2 周 → low；2 周–1 月 → mid；1 月以上 → high
 */
export function finishNudgeIntensity(lastReadAt: string | null | undefined): FinishNudgeIntensity {
  const days = idleDaysSinceLastRead(lastReadAt)
  if (days >= 30) return 'high'
  if (days >= 14) return 'mid'
  return 'low'
}
