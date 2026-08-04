/** 搜索结果关键词高亮（安全拆分，不注入 HTML） */

import type { ReactNode } from 'react'

export interface HighlightPart {
  text: string
  hit: boolean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeForMatch(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** 生成用于高亮的查询片段：整词优先，再拆出较长子词（适配划词长句） */
export function highlightTerms(query: string): string[] {
  const q = normalizeForMatch(query)
  if (!q) return []
  const terms: string[] = [q]
  const parts = q.split(/[\s\u3000,，.。;；:：!！?？、"'“”‘’（）()[\]【】]+/).filter((p) => p.length >= 2)
  for (const p of parts) {
    if (!terms.some((t) => t === p)) terms.push(p)
  }
  // 长句再取前 12 / 后 12 字，提高与 snippet 局部重合时的命中率
  if (q.length > 16) {
    const head = q.slice(0, 12)
    const tail = q.slice(-12)
    for (const p of [head, tail]) {
      if (p.length >= 2 && !terms.some((t) => t === p)) terms.push(p)
    }
  }
  // 长词在前，避免短词先切开
  return terms.sort((a, b) => b.length - a.length)
}

/** 按查询词（不区分大小写）拆分文本，命中段 hit=true */
export function splitHighlightParts(text: string, query: string): HighlightPart[] {
  const raw = text ?? ''
  const terms = highlightTerms(query)
  if (!raw || !terms.length) return [{ text: raw, hit: false }]

  try {
    const pattern = terms.map(escapeRegExp).join('|')
    const re = new RegExp(`(${pattern})`, 'gi')
    const chunks = raw.split(re)
    const lowerTerms = new Set(terms.map((t) => t.toLowerCase()))
    const parts: HighlightPart[] = []
    for (const chunk of chunks) {
      if (!chunk) continue
      parts.push({ text: chunk, hit: lowerTerms.has(chunk.toLowerCase()) })
    }
    return parts.length ? parts : [{ text: raw, hit: false }]
  } catch {
    return [{ text: raw, hit: false }]
  }
}

export function HighlightedText({
  text,
  query,
  className,
}: {
  text: string
  query: string
  className?: string
}): ReactNode {
  const parts = splitHighlightParts(text, query)
  if (parts.length === 1 && !parts[0].hit) {
    return <span className={className}>{text}</span>
  }
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="search-hit-mark">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  )
}
