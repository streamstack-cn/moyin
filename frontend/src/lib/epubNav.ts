import type { NavItem } from 'epubjs/types/navigation'

/** EPUB 无固定纸书页码；用字符块生成虚拟页。约 720 字更接近一屏中文阅读量。 */
export const EPUB_LOC_CHARS = 720

export function epubLocCacheKey(bookId: string) {
  return `moyin_epub_locs_v2_${bookId}_${EPUB_LOC_CHARS}`
}

export function loadCachedEpubLocations(bookId: string): string | null {
  try {
    return localStorage.getItem(epubLocCacheKey(bookId))
  } catch {
    return null
  }
}

export function saveCachedEpubLocations(bookId: string, json: string) {
  try {
    localStorage.setItem(epubLocCacheKey(bookId), json)
  } catch {
    /* quota / private mode */
  }
}

export function flattenToc(items: NavItem[], depth = 0): { item: NavItem; depth: number }[] {
  return items.flatMap((item) => [{ item, depth }, ...flattenToc(item.subitems || [], depth + 1)])
}

/** 合并 EPUB 相对路径（处理 ../） */
export function joinEpubHref(baseDir: string, rel: string): string {
  if (!rel) return baseDir.replace(/\/$/, '')
  if (rel.startsWith('#') || rel.startsWith('epubcfi(') || /^(https?:|mailto:)/i.test(rel)) return rel
  const raw = rel.startsWith('/') ? rel.replace(/^\/+/, '') : `${baseDir}${rel}`
  const stack: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

export function findChapterTitle(toc: NavItem[], href: string): string {
  const flat = flattenToc(toc)
  const cleanHref = href.split('#')[0]
  const match = flat.find((f) => f.item.href.split('#')[0] === cleanHref)
  return match?.item.label?.trim() || ''
}
