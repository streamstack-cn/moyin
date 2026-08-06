/**
 * AI 伴读报告展示格式化：把 LLM 可能返回的嵌套对象 / 英文字段名
 * 规范成中文可读文本。历史报告同样走这里，无需重新生成。
 */

export const REPORT_FIELD_LABELS: Record<string, string> = {
  insight: '要点',
  insights: '要点',
  point: '要点',
  key_point: '要点',
  keyPoint: '要点',
  takeaway: '要点',
  argument: '论证',
  argumentation: '论证',
  reasoning: '论证',
  rationale: '论证',
  evidence: '论证',
  support: '论证',
  my_thought_process: '我的思考',
  my_thoughts: '我的思考',
  myThoughts: '我的思考',
  thought_process: '我的思考',
  thoughtProcess: '我的思考',
  reflection: '我的思考',
  reflections: '我的思考',
  action: '行动建议',
  question: '疑问',
  summary: '总结',
  quote: '引用',
  conclusion: '结论',
  example: '举例',
  application: '应用',
  connection: '关联',
  title: '标题',
  content: '内容',
  detail: '细节',
  chapter: '章节',
  suggestion: '建议',
  analysis: '分析',
  observation: '观察',
  要点: '要点',
  论证: '论证',
  我的思考: '我的思考',
  洞察: '要点',
  反思: '我的思考',
}

/** 核心收获条目内字段的优先展示顺序 */
export const INSIGHT_FIELD_ORDER = ['要点', '论证', '我的思考', '洞察', '反思', '结论', '建议']

export function labelReportField(key: string): string {
  return REPORT_FIELD_LABELS[key] || REPORT_FIELD_LABELS[key.toLowerCase()] || key
}

/**
 * 把「行首/换行后紧跟的英文标签 + 冒号」替换成中文。
 */
export function sanitizeReportText(text: string): string {
  const keys = Object.keys(REPORT_FIELD_LABELS)
    .filter((k) => /^[A-Za-z_]/.test(k))
    .sort((a, b) => b.length - a.length)
  if (!keys.length) return text
  const pattern = new RegExp(`(^|[\\n。！？.!?]\\s*)(${keys.join('|')})\\s*[：:]`, 'gi')
  return text.replace(pattern, (_m, pre: string, key: string) => `${pre}${labelReportField(key)}：`)
}

export function renderReportObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj)
  const ordered: string[] = []
  for (const prefer of INSIGHT_FIELD_ORDER) {
    if (keys.includes(prefer)) ordered.push(prefer)
  }
  // 英文 key 按中文标签归并到优先序
  for (const prefer of INSIGHT_FIELD_ORDER) {
    for (const k of keys) {
      if (ordered.includes(k)) continue
      if (labelReportField(k) === prefer) ordered.push(k)
    }
  }
  for (const k of keys) {
    if (!ordered.includes(k)) ordered.push(k)
  }
  return ordered
    .map((k) => `${labelReportField(k)}：${renderReportValue(obj[k])}`)
    .join('\n')
}

export function renderReportValue(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return sanitizeReportText(val)
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) {
    return val
      .map((v, i) => {
        const body = renderReportValue(v)
        if (!body) return ''
        if (v && typeof v === 'object' && !Array.isArray(v)) return `（${i + 1}）\n${body}`
        return body
      })
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof val === 'object') return renderReportObject(val as Record<string, unknown>)
  return String(val)
}

/** 将报告字段规范为可展示字符串（编辑态也用展平后的文本，避免对象进 textarea） */
export function normalizeReportFieldForEdit(val: unknown): string {
  return renderReportValue(val)
}
