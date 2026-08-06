import { useState } from 'react'
import { Copy, Languages, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { copyTextToClipboard } from '../lib/clipboard'
import { providerLabel } from '../lib/readerTranslate'
import type { TranslatePanelEntry } from '../hooks/useReaderSelectionTranslate'

interface Props {
  entry: TranslatePanelEntry | null
  onExplain: (question?: string) => void | Promise<void>
}

export default function ReaderTranslatePanel({ entry, onExplain }: Props) {
  const [question, setQuestion] = useState('')

  if (!entry) {
    return (
      <div className="reader-translate-panel empty">
        <Languages size={28} strokeWidth={1.5} />
        <p>划选英文后将自动翻译；也可在气泡中点「翻译」。</p>
      </div>
    )
  }

  async function copyTranslation() {
    if (!entry?.translation) return
    const ok = await copyTextToClipboard(entry.translation)
    if (ok) toast.success('已复制译文')
    else toast.error('复制失败')
  }

  return (
    <div className="reader-translate-panel">
      <section className="reader-translate-block">
        <div className="reader-translate-label">原文</div>
        <p className="reader-translate-source">{entry.text}</p>
      </section>

      <section className="reader-translate-block">
        <div className="reader-translate-label-row">
          <span className="reader-translate-label">译文</span>
          {entry.provider && (
            <span className="reader-translate-provider">{providerLabel(entry.provider)}</span>
          )}
          {entry.translation && (
            <button type="button" className="reader-translate-copy" onClick={() => void copyTranslation()}>
              <Copy size={13} />
              复制
            </button>
          )}
        </div>
        <p className="reader-translate-target">
          {entry.translation || '（尚无译文，请先在气泡中翻译）'}
        </p>
      </section>

      <section className="reader-translate-block">
        <div className="reader-translate-label">请 AI 解释</div>
        <textarea
          className="reader-translate-question"
          rows={2}
          placeholder="例如：这个词在语境里是什么意思？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary reader-translate-ask"
          disabled={entry.explaining}
          onClick={() => void onExplain(question.trim() || undefined)}
        >
          <Sparkles size={14} />
          {entry.explaining ? '解释中…' : '请 AI 解释'}
        </button>
        {entry.explainError && <p className="reader-translate-error">{entry.explainError}</p>}
        {entry.explanation && <p className="reader-translate-explanation">{entry.explanation}</p>}
      </section>
    </div>
  )
}
