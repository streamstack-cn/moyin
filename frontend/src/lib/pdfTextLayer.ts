/** 扫描版/纯图页通常没有有效文字层；过短的空白/页码噪声不算可选文字 */
export function pageHasSelectableText(items: unknown[] | undefined): boolean {
  let chars = 0
  for (const it of items || []) {
    if (!it || typeof it !== 'object' || !('str' in it)) continue
    const raw = (it as { str?: unknown }).str
    if (typeof raw !== 'string') continue
    const s = raw.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim()
    chars += s.length
    if (chars >= 2) return true
  }
  return false
}

export function noTextHintDismissKey(bookId: string) {
  return `moyin_pdf_notext_hint_dismiss_${bookId}`
}

export function noTextToastKey(bookId: string) {
  return `moyin_pdf_notext_toast_${bookId}`
}
