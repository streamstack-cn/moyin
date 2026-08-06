type Props = {
  title?: string
  label?: string
  pageInput: string
  totalLabel: string
  percent: number
  disabled?: boolean
  onPageInputChange: (digits: string) => void
  onJump: (raw?: string) => void
}

/** EPUB / PDF 共用的页码跳转控件（样式类名不变） */
export default function ReaderProgressJump({
  title,
  label,
  pageInput,
  totalLabel,
  percent,
  disabled,
  onPageInputChange,
  onJump,
}: Props) {
  return (
    <div className="reader-progress-jump" title={title || '输入页码后回车跳转'}>
      {label ? <span className="reader-progress-label">{label}</span> : null}
      <input
        className="reader-page-input"
        value={pageInput}
        onChange={(e) => onPageInputChange(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => onJump()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
            onJump(e.currentTarget.value)
          }
        }}
        aria-label="跳转到页码"
        disabled={disabled}
      />
      <span className="reader-progress-meta">
        / {totalLabel} · {percent}%
      </span>
    </div>
  )
}
