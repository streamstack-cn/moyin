/** 阅读器选区定位：跨 EPUB/PDF 的轻量纯函数 */

/** EPUB：系统临时 mobile- 前缀不算可持久定位 */
export function epubPersistableLocator(cfiRange: string | null | undefined): string {
  if (!cfiRange || cfiRange.startsWith('mobile-')) return ''
  return cfiRange
}

/** PDF：优先用选区 locator，否则回落到当前页 */
export function pdfPersistableLocator(locator: string | null | undefined, page: number): string {
  if (locator && locator.trim()) return locator
  return `pdf:#page=${page}`
}
