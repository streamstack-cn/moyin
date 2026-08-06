import type { ReactNode } from 'react'
import {
  parseReportDisplayBlocks,
  sectionKindForKey,
  type ReportDisplayBlock,
  type ReportSectionKind,
} from '../lib/aiReportFormat'

function InsightCard({ block }: { block: Extract<ReportDisplayBlock, { type: 'insight' }> }) {
  const index = String(block.index).padStart(2, '0')
  return (
    <article className="ai-insight-card">
      <div className="ai-insight-index" aria-hidden>
        {index}
      </div>
      <div className="ai-insight-fields">
        {block.fields.map((f) => (
          <div key={`${block.index}-${f.label}`} className="ai-insight-field">
            <span className="ai-insight-field-label">{f.label}</span>
            <p className="ai-insight-field-text">{f.text}</p>
          </div>
        ))}
      </div>
    </article>
  )
}

function renderBlocks(blocks: ReportDisplayBlock[], kind: ReportSectionKind) {
  if (!blocks.length) return null

  if (kind === 'insights' || blocks.some((b) => b.type === 'insight')) {
    return (
      <div className="ai-insight-list">
        {blocks.map((b, i) =>
          b.type === 'insight' ? (
            <InsightCard key={b.index} block={b} />
          ) : (
            <p key={i} className="ai-report-prose">
              {b.type === 'bullet' ? b.text : b.type === 'paragraph' ? b.text : ''}
            </p>
          ),
        )}
      </div>
    )
  }

  if (kind === 'quote') {
    const text = blocks
      .map((b) => (b.type === 'paragraph' || b.type === 'bullet' ? b.text : ''))
      .filter(Boolean)
      .join('\n\n')
    return (
      <blockquote className="ai-report-pullquote">
        <span className="ai-report-pullquote-mark" aria-hidden>
          “
        </span>
        <div className="ai-report-pullquote-body">
          {text.split('\n\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </blockquote>
    )
  }

  if (kind === 'advice') {
    return (
      <ul className="ai-report-advice-list">
        {blocks.map((b, i) => (
          <li key={i}>{b.type === 'insight' ? b.fields.map((f) => f.text).join(' ') : b.text}</li>
        ))}
      </ul>
    )
  }

  if (kind === 'lede') {
    return (
      <div className="ai-report-lede">
        {blocks.map((b, i) =>
          b.type === 'paragraph' || b.type === 'bullet' ? (
            <p key={i}>{b.text}</p>
          ) : null,
        )}
      </div>
    )
  }

  return (
    <div className="ai-report-prose-stack">
      {blocks.map((b, i) =>
        b.type === 'paragraph' || b.type === 'bullet' ? (
          <p key={i} className="ai-report-prose">
            {b.text}
          </p>
        ) : null,
      )}
    </div>
  )
}

/** 单节报告正文：按字段类型用不同高级排版，不改存库结构 */
export function AiReportSectionBody({
  sectionKey,
  value,
}: {
  sectionKey: string
  value: unknown
}): ReactNode {
  const kind = sectionKindForKey(sectionKey)
  const blocks = parseReportDisplayBlocks(value, kind)
  if (!blocks.length) return null
  return <div className={`ai-report-section-body is-${kind}`}>{renderBlocks(blocks, kind)}</div>
}
