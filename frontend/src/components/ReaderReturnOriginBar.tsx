import { Undo2, X } from 'lucide-react'

/**
 * 阅读器「返回原处」浮条：
 * - 非翻页/页码跳转（目录、脚注内链、搜索命中、笔记高亮等）后出现
 * - 主按钮回到压栈位置；关闭按钮丢弃本次回溯
 */
export default function ReaderReturnOriginBar({
  visible,
  onReturn,
  onDismiss,
}: {
  visible: boolean
  onReturn: () => void
  onDismiss: () => void
}) {
  if (!visible) return null

  return (
    <div
      className="reader-return-origin"
      role="status"
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" className="reader-return-origin-main" onClick={onReturn}>
        <Undo2 size={15} />
        <span>返回原处</span>
      </button>
      <button
        type="button"
        className="reader-return-origin-close"
        onClick={onDismiss}
        aria-label="关闭返回原处"
        title="关闭"
      >
        <X size={14} />
      </button>
    </div>
  )
}
