import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  BookMarked,
  ChevronRight,
  FolderPlus,
  Highlighter,
  Languages,
  Loader2,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  X,
} from 'lucide-react'
import type { CitationProject } from '../api/types'
import { HIGHLIGHT_COLORS, type SelectionAnchor } from '../lib/readerConstants'
import { providerLabel, type BubbleTranslateState } from '../lib/readerTranslate'
import {
  placeSelectionBar,
  SELECTION_BAR_H,
  SELECTION_BAR_H_WITH_TRANSLATE,
  SELECTION_BAR_W,
} from '../lib/selectionBubblePlacement'

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
  onAddToNewBasket: (name: string) => void | Promise<void>
  onQuickFootnote: () => void
  onDismiss: () => void
  containerWidth?: number
  containerHeight?: number
  interactingRef?: MutableRefObject<boolean>
  translate?: BubbleTranslateState
  onTranslate?: () => void
  onToggleTranslatePanel?: () => void
  translatePanelOpen?: boolean
  portalRoot?: HTMLElement | null
  /** bar=桌面贴选区悬浮条；sheet=移动端嵌在底栏进度/页码区域的自适应操作条 */
  variant?: 'bar' | 'sheet'
}

export default function SelectionBubble({
  anchor,
  text,
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
  onAddToNewBasket,
  onQuickFootnote,
  onDismiss,
  interactingRef,
  translate,
  onTranslate,
  onToggleTranslatePanel,
  translatePanelOpen = false,
  portalRoot,
  variant = 'bar',
}: SelectionBubbleProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [newBasketOpen, setNewBasketOpen] = useState(false)
  const [newBasketName, setNewBasketName] = useState('')
  const [creatingBasket, setCreatingBasket] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ left: number; top: number; placement: string } | null>(null)

  const isCompactViewport = () =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(max-width: 860px)').matches || window.matchMedia('(pointer: coarse)').matches)

  const [portalEl, setPortalEl] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null
    // sheet 优先挂到底栏槽位，避免全屏遮罩挡选区手柄
    if (variant === 'sheet' && portalRoot) return portalRoot
    if (isCompactViewport()) return document.body
    if (portalRoot) return portalRoot
    return (document.querySelector('.reader-shell') as HTMLElement | null) || document.body
  })

  useEffect(() => {
    if (variant === 'sheet') {
      setPortalEl(portalRoot || document.body)
      return
    }
    if (isCompactViewport()) {
      setPortalEl(document.body)
      return
    }
    setPortalEl(portalRoot || document.querySelector('.reader-shell') || document.body)
  }, [portalRoot, variant])

  // sheet 打开时默认展开「更多」区之外的主操作；更多仍可折叠
  useEffect(() => {
    if (variant === 'sheet') setMoreOpen(false)
  }, [variant, text])

  const hasTranslateRow =
    Boolean(translate) &&
    (translate?.status === 'loading' ||
      translate?.status === 'error' ||
      (translate?.status === 'done' && Boolean(translate.translation)))

  useLayoutEffect(() => {
    if (variant === 'sheet') {
      setBox(null)
      return
    }
    const screen = anchor?.screen
    if (!screen) {
      setBox(null)
      return
    }
    const el = rootRef.current
    const vw = typeof window !== 'undefined' ? window.innerWidth : 390
    const compact = isCompactViewport()
    const measuredH =
      el?.offsetHeight || (hasTranslateRow ? SELECTION_BAR_H_WITH_TRANSLATE : SELECTION_BAR_H)
    const measuredW = Math.min(
      SELECTION_BAR_W,
      Math.max(el?.offsetWidth || 300, compact ? 280 : 268),
      vw - (compact ? 16 : 20),
    )
    const next = placeSelectionBar({
      screen,
      menuW: measuredW,
      menuH: measuredH,
      // 避开顶栏 / 底栏与安全区
      safeTop: compact ? 72 : 12,
      safeBottom: compact ? 56 : 12,
    })
    setBox(next)
  }, [anchor?.screen, hasTranslateRow, moreOpen, translate?.status, translate?.translation, variant])

  function markInteracting(on: boolean) {
    if (!interactingRef) return
    interactingRef.current = on
  }

  // 卸载时必须解开 interacting，否则关闭「更多」后翻页手势会永久失效
  useEffect(() => {
    return () => {
      if (interactingRef) interactingRef.current = false
    }
  }, [interactingRef])

  async function submitNewBasket() {
    const name = newBasketName.trim()
    if (!name || creatingBasket) return
    setCreatingBasket(true)
    try {
      await onAddToNewBasket(name)
    } finally {
      setCreatingBasket(false)
    }
  }

  function onTranslateClick() {
    if (translate?.status === 'done' && translate.translation && onToggleTranslatePanel) {
      onToggleTranslatePanel()
      return
    }
    onTranslate?.()
  }

  const translateLabel =
    translate?.status === 'loading'
      ? '翻译中'
      : translate?.status === 'done' && translate.translation
        ? translatePanelOpen
          ? '关闭'
          : '译文'
        : '翻译'

  const preview = text.trim().slice(0, 180)
  const previewMore = text.trim().length > 180

  const moreExtras = (
    <>
      <button type="button" className="selection-menu-item" onClick={() => setNoteOpen((v) => !v)}>
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

      <button type="button" className="selection-menu-item" onClick={() => setNewBasketOpen((v) => !v)}>
        <FolderPlus size={16} />
        <span>加入新增引用篮</span>
      </button>
      {newBasketOpen && (
        <div className="selection-menu-note">
          <input
            className="selection-menu-note-input selection-menu-new-basket-input"
            placeholder="输入新引用篮名称…"
            value={newBasketName}
            onChange={(e) => setNewBasketName(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewBasket()
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={creatingBasket || !newBasketName.trim()}
            onClick={() => void submitNewBasket()}
          >
            {creatingBasket ? '创建中…' : '创建并加入'}
          </button>
        </div>
      )}

      {onTranslate && (
        <button type="button" className="selection-menu-item" onClick={() => onTranslate()}>
          <Languages size={16} />
          <span>{translate?.status === 'done' ? '重新翻译' : '翻译'}</span>
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
    </>
  )

  const morePanel = moreOpen && (
    <div className="selection-uiverse">
      <div className="selection-uiverse-glass selection-uiverse-glass--panel">
        <div className="selection-apple-more-head">
          <span>更多操作</span>
          <button
            type="button"
            className="selection-menu-close"
            onClick={() => {
              // 只收起「更多」，不取消选区
              setMoreOpen(false)
              markInteracting(false)
            }}
            aria-label="关闭更多"
          >
            <X size={14} />
          </button>
        </div>
        {moreExtras}
      </div>
    </div>
  )

  const translateBlock = hasTranslateRow && (
    <div className={variant === 'sheet' ? 'selection-chrome-translate' : 'selection-apple-translate'}>
      {translate?.status === 'loading' && (
        <span className="selection-apple-translate-text muted">
          <Loader2 size={13} className="spin" /> 翻译中…
        </span>
      )}
      {translate?.status === 'error' && (
        <span className="selection-apple-translate-text error">{translate.error || '翻译失败'}</span>
      )}
      {translate?.status === 'done' && translate.translation && (
        <>
          <span className="selection-apple-translate-text" title={translate.translation}>
            {translate.provider ? `${providerLabel(translate.provider)} · ` : ''}
            {translate.translation}
          </span>
          {onToggleTranslatePanel && (
            <button type="button" className="selection-apple-translate-action" onClick={onToggleTranslatePanel}>
              {translatePanelOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
              {translatePanelOpen ? '关闭面板' : '展开面板'}
            </button>
          )}
        </>
      )}
    </div>
  )

  if (variant === 'sheet') {
    // 嵌在底栏内：无全屏遮罩，不挡 iOS 选区手柄；宽度随底栏自适应均分
    const chrome = (
      <div
        ref={rootRef}
        className="selection-chrome-bar"
        role="toolbar"
        aria-label="选区操作"
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={() => markInteracting(true)}
        onPointerUp={() => {
          window.setTimeout(() => markInteracting(false), 400)
        }}
        onPointerCancel={() => markInteracting(false)}
      >
        {moreOpen && (
          <div className="selection-chrome-more">
            <div className="selection-uiverse-glass selection-uiverse-glass--panel">
              <div className="selection-apple-more-head">
                <span>更多操作</span>
                <button
                  type="button"
                  className="selection-menu-close"
                  onClick={() => {
                    // 只收起「更多」，不取消选区（取消选区靠点正文/清除）
                    setMoreOpen(false)
                    markInteracting(false)
                  }}
                  aria-label="关闭更多"
                >
                  <X size={14} />
                </button>
              </div>
              {moreExtras}
            </div>
          </div>
        )}
        <div className="selection-chrome-actions">
          <button type="button" className="selection-chrome-btn" onClick={onCopy}>
            复制
          </button>
          <button type="button" className="selection-chrome-btn" onClick={onTranslateClick}>
            {translate?.status === 'loading' ? <Loader2 size={14} className="spin" /> : null}
            {translateLabel}
          </button>
          <button type="button" className="selection-chrome-btn" onClick={onAddToBasket}>
            引用
          </button>
          <button type="button" className="selection-chrome-btn" onClick={onQuickFootnote}>
            脚注
          </button>
          <button
            type="button"
            className={`selection-chrome-btn selection-chrome-more-btn${moreOpen ? ' active' : ''}`}
            onClick={() => setMoreOpen((v) => !v)}
          >
            更多
            <ChevronRight size={14} />
          </button>
          <button type="button" className="selection-chrome-btn" onClick={onDismiss} aria-label="完成并清除选区">
            完成
          </button>
        </div>
        {preview && (
          <div className="selection-chrome-preview" title={text}>
            {preview}
            {previewMore ? '…' : ''}
          </div>
        )}
        {translateBlock}
      </div>
    )
    if (!portalEl) return null
    return createPortal(chrome, portalEl)
  }

  const placement = box?.placement ?? 'anchored-above'
  const moreBelow = placement === 'anchored-below'

  const menu = (
    <div
      ref={rootRef}
      className={`selection-apple ${placement}${moreOpen ? ' is-more-open' : ''}${isCompactViewport() ? ' selection-apple--compact' : ''}`}
      style={
        box
          ? { left: box.left, top: box.top, position: 'fixed', zIndex: isCompactViewport() ? 1100 : 220 }
          : { position: 'fixed', left: -9999, top: -9999, visibility: 'hidden' as const }
      }
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={() => markInteracting(true)}
      onPointerUp={() => {
        window.setTimeout(() => markInteracting(false), 400)
      }}
      onPointerCancel={() => markInteracting(false)}
      role="menu"
      aria-label="选区操作"
    >
      {!moreBelow && morePanel}

      <div className="selection-uiverse">
        <div className="selection-uiverse-glass">
          <div className="selection-apple-bar">
            <button type="button" className="selection-apple-btn" role="menuitem" onClick={onCopy}>
              复制
            </button>
            <span className="selection-apple-sep" aria-hidden />
            <button type="button" className="selection-apple-btn" role="menuitem" onClick={onTranslateClick}>
              {translate?.status === 'loading' ? <Loader2 size={14} className="spin" /> : null}
              {translateLabel}
            </button>
            <span className="selection-apple-sep" aria-hidden />
            <button type="button" className="selection-apple-btn" role="menuitem" onClick={onAddToBasket}>
              引用
            </button>
            <span className="selection-apple-sep" aria-hidden />
            <button type="button" className="selection-apple-btn" role="menuitem" onClick={onQuickFootnote}>
              脚注
            </button>
            <span className="selection-apple-sep" aria-hidden />
            <button
              type="button"
              className={`selection-apple-btn selection-apple-more-btn${moreOpen ? ' active' : ''}`}
              role="menuitem"
              onClick={() => setMoreOpen((v) => !v)}
            >
              更多
              <ChevronRight size={14} />
            </button>
          </div>
          {translateBlock}
        </div>
      </div>

      {moreBelow && morePanel}
    </div>
  )

  if (!portalEl) return null
  return createPortal(menu, portalEl)
}
