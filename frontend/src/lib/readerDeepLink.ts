/** 阅读器深链：定位 CFI + 可选搜索词（用于跳转后短暂高亮） */

export function readerDeepLink(
  bookId: string,
  opts: { cfi?: string | null; q?: string | null; restart?: boolean } = {},
): string {
  const params = new URLSearchParams()
  const cfi = (opts.cfi || '').trim()
  const q = (opts.q || '').trim().slice(0, 80)
  if (cfi) params.set('cfi', cfi)
  if (q) params.set('q', q)
  if (opts.restart) params.set('restart', '1')
  const qs = params.toString()
  return qs ? `/read/${bookId}?${qs}` : `/read/${bookId}`
}
