/** 电子书格式展示：角标 class / 标签文案 */

/** 归一化格式键（用于 CSS class） */
export function normalizeBookFormat(format?: string | null): string {
  const f = (format || '').trim().toLowerCase()
  if (!f) return 'unknown'
  if (f === 'azw3' || f === 'azw') return 'azw'
  if (f === 'cbr') return 'cbr'
  return f
}

export function formatLabel(format?: string | null): string {
  const raw = (format || '').trim()
  return raw ? raw.toUpperCase() : 'FILE'
}

/** 封面角标：book-format-chip format-epub … */
export function formatChipClass(format?: string | null): string {
  return `book-format-chip format-${normalizeBookFormat(format)}`
}

/** 详情等徽章：badge badge-format format-pdf … */
export function formatBadgeClass(format?: string | null): string {
  return `badge badge-format format-${normalizeBookFormat(format)}`
}
