import type { BookSummary } from '../api/types'

const REC_POOL_KEY = 'moyin_recommend_pool_offset'
/** 候选池大小：从高分里取一批再轮换，避免永远只露最前面那几本 */
const REC_POOL_SIZE = 40

function statusWeight(status: BookSummary['reading_status']): number {
  // 未读优先，在读次之；已读沉到后面，避免推荐栏长期占着看过的书
  if (status === 'unread') return 3
  if (status === 'reading') return 2
  return 0
}

function daySalt(): number {
  return Math.floor(Date.now() / 86_400_000)
}

/** 读取/推进「换一批」偏移；换一天时自动归零，与日更轮换对齐 */
export function getRecommendOffset(): number {
  try {
    const raw = sessionStorage.getItem(REC_POOL_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { day?: number; offset?: number }
    if (parsed.day !== daySalt()) return 0
    return Math.max(0, Number(parsed.offset) || 0)
  } catch {
    return 0
  }
}

export function bumpRecommendOffset(poolSize: number, step: number): number {
  const next = poolSize <= 0 ? 0 : (getRecommendOffset() + step) % poolSize
  try {
    sessionStorage.setItem(REC_POOL_KEY, JSON.stringify({ day: daySalt(), offset: next }))
  } catch {
    /* private mode */
  }
  return next
}

/**
 * 高分推荐挑选：
 * 1. 有豆瓣评分
 * 2. 未读 / 在读优先于已读
 * 3. 同分按评分高低
 * 4. 取前 REC_POOL_SIZE 本作为池，按「日期 + 换一批偏移」轮换展示
 */
export function pickRecommendedBooks(
  books: BookSummary[],
  capacity: number,
  offset = getRecommendOffset(),
): { pool: BookSummary[]; visible: BookSummary[] } {
  const ranked = books
    .filter((b) => (b.rating || 0) > 0)
    .slice()
    .sort((a, b) => {
      const wa = statusWeight(a.reading_status)
      const wb = statusWeight(b.reading_status)
      if (wb !== wa) return wb - wa
      return (b.rating || 0) - (a.rating || 0)
    })

  const poolSize = Math.max(capacity, Math.min(REC_POOL_SIZE, ranked.length))
  const pool = ranked.slice(0, poolSize)
  if (pool.length === 0) return { pool, visible: [] }

  // 日更盐：即使不点「换一批」，每天首屏也从池子的不同位置开始
  const start = (offset + daySalt()) % pool.length
  const rotated = pool.slice(start).concat(pool.slice(0, start))
  return { pool, visible: rotated.slice(0, Math.max(1, capacity)) }
}
