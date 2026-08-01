/** 在 DOM 子树中定位关键词（单文本节点内匹配），返回 Range 列表 */

export function findKeywordRanges(root: ParentNode, keyword: string, limit = 40): Range[] {
  const needle = keyword.trim().toLowerCase()
  if (!needle || !root) return []
  const owner = root instanceof Document ? root : root.ownerDocument
  if (!owner) return []

  const ranges: Range[] = []
  const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node.textContent || ''
    if (!text) continue
    const lower = text.toLowerCase()
    let from = 0
    while (ranges.length < limit) {
      const at = lower.indexOf(needle, from)
      if (at < 0) break
      try {
        const range = owner.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        ranges.push(range)
      } catch {
        /* ignore invalid offsets */
      }
      from = at + Math.max(1, needle.length)
    }
    if (ranges.length >= limit) break
  }
  return ranges
}
