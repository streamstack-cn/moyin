import { useState, type MutableRefObject } from 'react'
import {
  BookMarked,
  Copy,
  Highlighter,
  NotebookPen,
  Quote,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import type { CitationProject } from '../api/types'
import { HIGHLIGHT_COLORS, type SelectionAnchor } from '../lib/readerConstants'
import { placeSelectionMenu } from '../lib/selectionBubblePlacement'

export interface SelectionBubbleProps {
  anchor: SelectionAnchor | null
  text: string
  pageValue: string
  onPageChange: (value: string) => void
  pagePlaceholder?: string
  pageTitle?: string
  projects: CitationProject[]
  projectId: string
  onProjectChange: (id: string) => void
  onHighlight: (color: string, note?: string) => void
  onCopy: () => void
  onAddToBasket: () => void
  onQuickFootnote: () => void
  onSearchInBook?: () => void
  onDismiss: () => void
  containerWidth?: number
  containerHeight?: number
  interactingRef?: MutableRefObject<boolean>
}

export default function SelectionBubble({
  anchor,
  pageValue,
  onPageChange,
  pagePlaceholder = '纸书页',
  pageTitle,
  projects,
  projectId,
  onProjectChange,
  onHighlight,
  onCopy,
  onAddToBasket,
  onQuickFootnote,
  onSearchInBook,
  onDismiss,
  containerWidth = 360,
  containerHeight = 640,
  interactingRef,
}: SelectionBubbleProps) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')

  // 松手后出现在指针右侧（placeSelectionMenu）；移动端无锚点时走底部 fallback
  const box = anchor
    ? placeSelectionMenu({
        anchor,
        containerW: containerWidth,
        containerH: containerHeight,
      })
    : null

  function markInteracting(on: boolean) {
    if (!interactingRef) return
    interactingRef.current = on
  }

  return (
    <div
      className={`selection-menu ${box?.placement ?? 'fallback'}`}
      style={box ? { left: box.left, top: box.top } : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={() => markInteracting(true)}
      onPointerUp={() => {
        window.setTimeout(() => markInteracting(false), 400)
      }}
      onPointerCancel={() => markInteracting(false)}
      role="menu"
      aria-label="选区操作"
    >
      <div className="selection-menu-header">
        <span>选区操作</span>
        <button type="button" className="selection-menu-close" onClick={onDismiss} aria-label="关闭">
          <X size={14} />
        </button>
      </div>

      <button type="button" className="selection-menu-item" role="menuitem" onClick={() => setNoteOpen((v) => !v)}>
        <NotebookPen size={16} />
        <span>添加笔记</span>
      </button>
      {noteOpen && (
        <div className="selection-menu-note">
          <textarea
            className="selection-menu-note-input"
            placeholder="写下批注…"
            value={note}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => onHighlight(HIGHLIGHT_COLORS[0], note.trim())}
          >
            保存笔记并高亮
          </button>
        </div>
      )}

      <button type="button" className="selection-menu-item" role="menuitem" onClick={onCopy}>
        <Copy size={16} />
        <span>复制</span>
      </button>

      <button type="button" className="selection-menu-item" role="menuitem" onClick={onAddToBasket}>
        <Sparkles size={16} />
        <span>加入引用篮</span>
      </button>

      <button type="button" className="selection-menu-item" role="menuitem" onClick={onQuickFootnote}>
        <Quote size={16} />
        <span>复制脚注</span>
      </button>

      {onSearchInBook && (
        <button type="button" className="selection-menu-item" role="menuitem" onClick={onSearchInBook}>
          <Search size={16} />
          <span>在本书内搜索</span>
        </button>
      )}

      <div className="selection-menu-page-row" title={pageTitle}>
        <BookMarked size={14} />
        <input
          className="selection-menu-page"
          placeholder={pagePlaceholder}
          value={pageValue}
          onChange={(e) => onPageChange(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
        />
        {projects.length > 0 && (
          <select
            className="selection-menu-project"
            value={projectId}
            onChange={(e) => onProjectChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            title="引用篮"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="selection-menu-colors" aria-label="高亮颜色">
        <Highlighter size={14} className="selection-menu-colors-icon" />
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="selection-menu-color"
            style={{ background: c }}
            title="高亮"
            aria-label="高亮"
            onClick={() => onHighlight(c)}
          />
        ))}
      </div>
    </div>
  )
}
