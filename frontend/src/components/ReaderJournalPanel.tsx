import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { X } from 'lucide-react'

type NoteSaveState = 'idle' | 'saving' | 'saved'
type JournalMode = 'edit' | 'preview'

interface Props {
  noteContent: string
  onChange: (value: string) => void
  noteSaveState: NoteSaveState
  journalMode: JournalMode
  setJournalMode: (mode: JournalMode) => void
  onClose: () => void
  paperBg: string
  paperFg: string
  /** 桌面侧栏宽度；移动端全屏时忽略 */
  width: number
  onResizePointerDown: (e: ReactPointerEvent) => void
  /** 是否显示左缘拖拽条（桌面 journal） */
  showResize?: boolean
}

export default function ReaderJournalPanel({
  noteContent,
  onChange,
  noteSaveState,
  journalMode,
  setJournalMode,
  onClose,
  paperBg,
  paperFg,
  width,
  onResizePointerDown,
  showResize = true,
}: Props) {
  const editorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (journalMode !== 'edit') return
    const t = window.setTimeout(() => editorRef.current?.focus(), 80)
    return () => window.clearTimeout(t)
  }, [journalMode])

  const style = {
    ['--journal-bg' as string]: paperBg,
    ['--journal-fg' as string]: paperFg,
    ['--journal-drawer-width' as string]: `${width}px`,
    width: showResize ? width : undefined,
  } as CSSProperties

  return (
    <div className="reader-drawer journal" style={style}>
      {showResize && (
        <div
          className="journal-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整笔记栏宽度"
          onPointerDown={onResizePointerDown}
        />
      )}
      <div className="reader-drawer-header journal-header">
        <div className="journal-header-text">
          <div className="journal-title">我的笔记</div>
          <div className="journal-subtitle">Markdown · 自动保存</div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭笔记" title="关闭">
          <X size={16} />
        </button>
      </div>

      <div className="journal-body">
        <div className="journal-toolbar" role="group" aria-label="编辑模式">
          <button
            type="button"
            className={`journal-mode-btn ${journalMode === 'edit' ? 'active' : ''}`}
            onClick={() => setJournalMode('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            className={`journal-mode-btn ${journalMode === 'preview' ? 'active' : ''}`}
            onClick={() => setJournalMode('preview')}
          >
            预览
          </button>
        </div>

        {journalMode === 'edit' ? (
          <textarea
            ref={editorRef}
            className="journal-editor"
            placeholder="边读边写……支持 # 标题、- 列表、**加粗**、> 引用"
            value={noteContent}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="journal-preview">
            {noteContent.trim() ? (
              <ReactMarkdown>{noteContent}</ReactMarkdown>
            ) : (
              <div className="journal-empty">还没有笔记内容</div>
            )}
          </div>
        )}

        <div className="journal-status">
          {noteSaveState === 'saving' && '正在保存…'}
          {noteSaveState === 'saved' && '已自动保存'}
          {noteSaveState === 'idle' && '修改后自动保存'}
        </div>
      </div>
    </div>
  )
}
