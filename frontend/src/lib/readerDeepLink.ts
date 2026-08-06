/** 阅读器深链：定位 CFI + 可选搜索词（用于跳转后短暂高亮）
 *
 * 带定位（cfi / q）的跳转会附带 peek=1：只打开到目标位置，不改「继续阅读」进度。
 * 进度仅在阅读器内翻页 / 指定页码等主动阅读行为后写入。
 */

export function readerDeepLink(
  bookId: string,
  opts: { cfi?: string | null; q?: string | null; restart?: boolean; peek?: boolean } = {},
): string {
  const params = new URLSearchParams()
  const cfi = (opts.cfi || '').trim()
  const q = (opts.q || '').trim().slice(0, 80)
  if (cfi) params.set('cfi', cfi)
  if (q) params.set('q', q)
  if (opts.restart) params.set('restart', '1')
  // 定位跳转默认 peek；显式 peek:false 可关掉（一般不需要）
  const peek = opts.peek ?? Boolean(cfi || q)
  if (peek) params.set('peek', '1')
  const qs = params.toString()
  return qs ? `/read/${bookId}?${qs}` : `/read/${bookId}`
}

/** 是否为「只定位、不改进度」的深链进入 */
export function isReaderPeekMode(searchParams: URLSearchParams): boolean {
  if (searchParams.get('peek') === '1') return true
  if (searchParams.get('restart') === '1') return false
  const cfi = (searchParams.get('cfi') || '').trim()
  const q = (searchParams.get('q') || '').trim()
  return Boolean(cfi || q)
}
