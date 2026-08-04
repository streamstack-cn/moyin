import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Maximize,
  Minimize,
  Minus,
  NotebookPen,
  Plus,
  X,
} from 'lucide-react'
import { api, ApiError, getToken } from '../api/client'
import type { BookDetail, BookNote, CitationProject, Highlight } from '../api/types'
import ReaderBookIdentity from '../components/ReaderBookIdentity'
import ReaderJournalPanel from '../components/ReaderJournalPanel'
import ReaderReturnOriginBar from '../components/ReaderReturnOriginBar'
import SelectionBubble from '../components/SelectionBubble'
import { useAuth } from '../contexts/AuthContext'
import { copyTextToClipboard } from '../lib/clipboard'
import { BASKET_PROJECT_KEY, type SelectionAnchor } from '../lib/readerConstants'
import { useJournalDrawerWidth } from '../lib/useJournalDrawerWidth'
import {
  isPdfLocator,
  locatorToRelativeRects,
  parsePdfLocator,
  pdfTargetPage,
  rangeToAnchor,
  selectionToPdfLocator,
  type RelativeRect,
} from '../lib/pdfLocator'
import { findKeywordRanges } from '../lib/findKeywordRanges'
import { highlightTerms } from '../lib/highlightQuery'
import {
  clearDomSelection,
  isIntentionalTextSelection,
  pointerTravel,
  selectionText,
} from '../lib/readerGestures'
import { pointerToViewport, withPointer } from '../lib/selectionBubblePlacement'
import { useReaderChromeInset } from '../lib/useReaderChromeInset'

import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorker

/** 扫描版/纯图页通常没有有效文字层；过短的空白/页码噪声不算可选文字 */
function pageHasSelectableText(items: unknown[] | undefined): boolean {
  let chars = 0
  for (const it of items || []) {
    if (!it || typeof it !== 'object' || !('str' in it)) continue
    const raw = (it as { str?: unknown }).str
    if (typeof raw !== 'string') continue
    const s = raw.replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim()
    chars += s.length
    if (chars >= 2) return true
  }
  return false
}

function noTextHintDismissKey(bookId: string) {
  return `moyin_pdf_notext_hint_dismiss_${bookId}`
}

function noTextToastKey(bookId: string) {
  return `moyin_pdf_notext_toast_${bookId}`
}

interface Props {
  book: BookDetail
}

interface PdfSelectionState {
  locator: string
  text: string
  anchor: SelectionAnchor | null
}

interface ActiveHighlightState {
  id: string
  x: number
  y: number
}

interface HlPaint {
  id: string
  color: string
  rects: RelativeRect[]
}

function pickDefaultBasketProjectId(projects: CitationProject[]): string {
  try {
    const saved = localStorage.getItem(BASKET_PROJECT_KEY)
    if (saved && projects.some((p) => p.id === saved)) return saved
  } catch {
    /* private mode */
  }
  return projects.find((p) => p.name === '默认引用篮')?.id || projects[0]?.id || ''
}

/** PDF 阅读器：pdf.js canvas + TextLayer 选区 + 软高亮 + 功能气泡（引用/脚注） */
export default function PdfReaderPage({ book }: Props) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, updatePreferences } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const hlLayerRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const textLayerInstRef = useRef<TextLayer | null>(null)
  const textDivsRef = useRef<HTMLElement[]>([])
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderTokenRef = useRef(0)
  const selectionRef = useRef<PdfSelectionState | null>(null)
  const bubbleInteractingRef = useRef(false)
  const selectingRef = useRef(false)
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const lastPresentAtRef = useRef(0)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const pointerMovePxRef = useRef(0)
  const isCompactRef = useRef(false)
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 860px)').matches : false,
  )

  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const currentPageRef = useRef(1)
  const navStackRef = useRef<number[]>([])
  const [canNavBack, setCanNavBack] = useState(false)
  /** 进度条一次拖动只压栈一次 */
  const scrubOriginPendingRef = useRef(false)
  const [totalPages, setTotalPages] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const [scale, setScale] = useState(() => {
    const fromUser = Number(user?.preferences?.reader_pdf_scale)
    if (fromUser >= 0.6 && fromUser <= 2.5) return fromUser
    const fromLocal = Number(localStorage.getItem('moyin_reader_pdf_scale'))
    if (fromLocal >= 0.6 && fromLocal <= 2.5) return fromLocal
    return 1.15
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [wheelPageTurn, setWheelPageTurn] = useState(true)
  const wheelEnabledRef = useRef(true)
  const lastWheelAtRef = useRef(0)
  const [showJournal, setShowJournal] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'journal' | 'notes' | null>(null)
  const [noteContent, setNoteContent] = useState('')
  const [noteSaveState, setNoteSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [journalMode, setJournalMode] = useState<'edit' | 'preview'>('edit')
  const [chromeVisible, setChromeVisible] = useState(true)
  const [selection, setSelection] = useState<PdfSelectionState | null>(null)
  const [basketPage, setBasketPage] = useState('')
  const [projects, setProjects] = useState<CitationProject[]>([])
  const [basketProjectId, setBasketProjectId] = useState('')
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [hlPaints, setHlPaints] = useState<HlPaint[]>([])
  const [flashPaints, setFlashPaints] = useState<HlPaint[]>([])
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlashKeyRef = useRef('')
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlightState | null>(null)
  const [textSelectable, setTextSelectable] = useState(true)
  const [noTextHintDismissed, setNoTextHintDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(noTextHintDismissKey(book.id)) === '1'
    } catch {
      return false
    }
  })
  const noTextToastShownRef = useRef(false)

  useEffect(() => {
    noTextToastShownRef.current = false
    try {
      setNoTextHintDismissed(sessionStorage.getItem(noTextHintDismissKey(book.id)) === '1')
    } catch {
      setNoTextHintDismissed(false)
    }
  }, [book.id])

  const percent =
    totalPages > 0 ? Math.max(page > 0 ? 1 : 0, Math.round((page / totalPages) * 100)) : 0

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    currentPageRef.current = page
  }, [page])

  useReaderChromeInset(shellRef)
  const { width: journalWidth, onResizePointerDown: onJournalResizePointerDown } = useJournalDrawerWidth()

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === shellRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const sync = () => {
      isCompactRef.current = mq.matches
      setIsCompact(mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    wheelEnabledRef.current = wheelPageTurn
  }, [wheelPageTurn])

  useEffect(() => {
    api
      .get<{ wheel_page_turn: boolean }>('/api/settings/reader')
      .then((r) => setWheelPageTurn(!!r.wheel_page_turn))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  useEffect(() => {
    api
      .get<CitationProject[]>('/api/citation/projects')
      .then((list) => {
        setProjects(list)
        setBasketProjectId(pickDefaultBasketProjectId(list))
      })
      .catch(() => {})
    api
      .get<Highlight[]>(`/api/highlights/book/${book.id}`)
      .then(setHighlights)
      .catch(() => {})
  }, [book.id])

  useEffect(() => {
    if (!projects.length) return
    if (!basketProjectId || !projects.some((p) => p.id === basketProjectId)) {
      setBasketProjectId(pickDefaultBasketProjectId(projects))
    }
  }, [projects, basketProjectId])

  useEffect(() => {
    if (!basketProjectId) return
    try {
      localStorage.setItem(BASKET_PROJECT_KEY, basketProjectId)
    } catch {
      /* private mode */
    }
  }, [basketProjectId])

  function changeScale(delta: number) {
    setScale((prev) => {
      const next = Math.min(2.5, Math.max(0.6, Math.round((prev + delta) * 10) / 10))
      try {
        localStorage.setItem('moyin_reader_pdf_scale', String(next))
      } catch {
        /* private mode */
      }
      if (user) void updatePreferences({ reader_pdf_scale: next })
      return next
    })
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!wheelEnabledRef.current) return
      if (selectingRef.current || selectionRef.current) return
      if (Math.abs(e.deltaY) < 8) return
      const now = Date.now()
      if (now - lastWheelAtRef.current < 280) return
      lastWheelAtRef.current = now
      e.preventDefault()
      if (e.deltaY > 0) setPage((p) => Math.min(totalPages || p, p + 1))
      else setPage((p) => Math.max(1, p - 1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [totalPages])

  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true)
      try {
        const [progress, note] = await Promise.all([
          api.get<{ location: string; percent: number }>(`/api/books/${book.id}/progress`),
          api.get<BookNote>(`/api/notes/${book.id}`).catch(() => ({ content: '' }) as BookNote),
        ])
        if (cancelled) return
        setNoteContent(note.content || '')

        const token = getToken()
        const loadingTask = getDocument({
          url: `/api/books/${book.id}/read`,
          httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        const pdf = await loadingTask.promise
        if (cancelled) {
          pdf.destroy()
          return
        }
        pdfRef.current = pdf
        setTotalPages(pdf.numPages)
        const restart = searchParams.get('restart') === '1'
        const fromCfi = pdfTargetPage(searchParams.get('cfi') || '')
        const clamp = (n: number) => Math.min(pdf.numPages, Math.max(1, n))
        if (restart) {
          setPage(1)
        } else if (fromCfi) {
          // 搜索/高亮深链优先于阅读进度
          setPage(clamp(fromCfi))
        } else {
          const savedPage = Number.parseInt(progress.location || '', 10)
          const startPage =
            Number.isFinite(savedPage) && savedPage >= 1 && savedPage <= pdf.numPages ? savedPage : 1
          setPage(startPage)
        }
      } catch (err) {
        if (!cancelled) toast.error(err instanceof ApiError ? err.message : '打开 PDF 失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
      textLayerInstRef.current?.cancel()
      textLayerInstRef.current = null
      pdfRef.current?.destroy()
      pdfRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  function pushNavBackPoint(): boolean {
    const p = currentPageRef.current
    if (!p || p < 1) return false
    const stack = navStackRef.current
    if (stack[stack.length - 1] !== p) stack.push(p)
    setCanNavBack(true)
    return true
  }

  function clearNavOrigin() {
    navStackRef.current = []
    setCanNavBack(false)
  }

  function goNavBack() {
    const p = navStackRef.current.pop()
    setCanNavBack(navStackRef.current.length > 0)
    if (p && p >= 1) setPage(p)
  }

  // 同一本书内更换 ?cfi= / ?restart= 时跳页，避免整本重载
  useEffect(() => {
    if (loading || totalPages < 1 || !pdfRef.current) return
    if (searchParams.get('restart') === '1') {
      setPage(1)
      return
    }
    const fromCfi = pdfTargetPage(searchParams.get('cfi') || '')
    if (!fromCfi) return
    const next = Math.min(totalPages, Math.max(1, fromCfi))
    if (next !== currentPageRef.current) pushNavBackPoint()
    setPage(next)
  }, [searchParams, loading, totalPages])

  // 同页仅更换搜索词时，文字层已在也可再闪一次
  useEffect(() => {
    if (loading || !textDivsRef.current.length) return
    const q = (searchParams.get('q') || '').trim()
    const cfi = (searchParams.get('cfi') || '').trim()
    if (!q && !cfi) {
      clearPdfSearchFlash()
      return
    }
    applyPdfSearchFlash(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading])

  function paintHighlightsForPage(pageNo: number, textDivs: HTMLElement[], pageEl: HTMLElement) {
    const paints: HlPaint[] = []
    for (const h of highlights) {
      const loc = parsePdfLocator(h.cfi_range)
      if (!loc || loc.page !== pageNo) continue
      const rects = locatorToRelativeRects(loc, textDivs, pageEl)
      if (rects.length) paints.push({ id: h.id, color: h.color || '#ffd54f', rects })
    }
    setHlPaints(paints)
  }

  function clearPdfSearchFlash() {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current)
      flashTimerRef.current = null
    }
    setFlashPaints([])
  }

  /** 搜索深链跳转后：在当前页短暂高亮命中（约 4 秒） */
  function applyPdfSearchFlash(force = false) {
    const q = (searchParams.get('q') || '').trim()
    const cfi = (searchParams.get('cfi') || '').trim()
    if (!q && !cfi) return
    const pageEl = pageRef.current
    const textLayer = textLayerRef.current
    if (!pageEl || !textLayer || !textDivsRef.current.length) return

    const key = `${book.id}@@${page}@@${cfi}@@${q}`
    if (!force && lastFlashKeyRef.current === key && flashPaints.length) return
    lastFlashKeyRef.current = key

    const paints: HlPaint[] = []
    const loc = parsePdfLocator(cfi)
    if (loc && loc.page === page) {
      const rects = locatorToRelativeRects(loc, textDivsRef.current, pageEl)
      if (rects.length) paints.push({ id: 'search-flash', color: '#ffb300', rects })
    }

    if (!paints.length && q) {
      for (const term of highlightTerms(q)) {
        const ranges = findKeywordRanges(textLayer, term, 24)
        if (!ranges.length) continue
        const pageBox = pageEl.getBoundingClientRect()
        const rects: RelativeRect[] = []
        for (const range of ranges) {
          for (const r of Array.from(range.getClientRects())) {
            if (r.width < 1 || r.height < 1) continue
            rects.push({
              left: r.left - pageBox.left,
              top: r.top - pageBox.top,
              width: r.width,
              height: r.height,
            })
          }
        }
        if (rects.length) {
          paints.push({ id: 'search-flash', color: '#ffb300', rects })
          break
        }
      }
    }

    if (!paints.length) return
    setFlashPaints(paints)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null
      setFlashPaints([])
    }, 4000)
  }

  useEffect(() => {
    async function renderPage() {
      const pdf = pdfRef.current
      const canvas = canvasRef.current
      const textLayerEl = textLayerRef.current
      const pageEl = pageRef.current
      if (!pdf || !canvas || !textLayerEl || !pageEl) return

      const token = ++renderTokenRef.current
      try {
        textLayerInstRef.current?.cancel()
        textLayerInstRef.current = null
        textLayerEl.replaceChildren()
        textDivsRef.current = []
        setHlPaints([])

        const pdfPage: PDFPageProxy = await pdf.getPage(page)
        if (token !== renderTokenRef.current) return

        const viewport = pdfPage.getViewport({ scale })
        const context = canvas.getContext('2d')
        if (!context) return
        canvas.height = viewport.height
        canvas.width = viewport.width
        pageEl.style.width = `${Math.floor(viewport.width)}px`
        pageEl.style.height = `${Math.floor(viewport.height)}px`

        await pdfPage.render({ canvasContext: context, viewport }).promise
        if (token !== renderTokenRef.current) return

        const textContent = await pdfPage.getTextContent()
        if (token !== renderTokenRef.current) return

        const hasText = pageHasSelectableText(textContent.items as unknown[])
        setTextSelectable(hasText)
        if (!hasText && !noTextToastShownRef.current) {
          noTextToastShownRef.current = true
          try {
            if (sessionStorage.getItem(noTextToastKey(book.id)) !== '1') {
              sessionStorage.setItem(noTextToastKey(book.id), '1')
              toast.message('此书部分页面无文字层（多为扫描版），无法划词高亮；可用笔记记录页码')
            }
          } catch {
            toast.message('此书部分页面无文字层（多为扫描版），无法划词高亮；可用笔记记录页码')
          }
        }

        textLayerEl.style.width = `${Math.floor(viewport.width)}px`
        textLayerEl.style.height = `${Math.floor(viewport.height)}px`
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport,
        })
        textLayerInstRef.current = textLayer
        await textLayer.render()
        if (token !== renderTokenRef.current) return
        textDivsRef.current = textLayer.textDivs
        paintHighlightsForPage(page, textLayer.textDivs, pageEl)
        // 文字层就绪后再闪搜索命中（首页/全库检索深链）
        applyPdfSearchFlash(true)

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          api
            .put(`/api/books/${book.id}/progress`, {
              location: String(page),
              percent: totalPages > 0 ? page / totalPages : 0,
            })
            .catch(() => {})
        }, 600)
      } catch {
        // 翻页竞态时忽略
      }
    }
    if (!loading) void renderPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scale, loading, book.id, totalPages])

  // 高亮列表变化后重绘当前页
  useEffect(() => {
    const pageEl = pageRef.current
    if (!pageEl || !textDivsRef.current.length) return
    paintHighlightsForPage(page, textDivsRef.current, pageEl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, page])

  function goPrev() {
    dismissSelection()
    setActiveHighlight(null)
    setPage((p) => Math.max(1, p - 1))
    if (isCompactRef.current) setChromeVisible(false)
  }

  function goNext() {
    dismissSelection()
    setActiveHighlight(null)
    setPage((p) => Math.min(totalPages || p, p + 1))
    if (isCompactRef.current) setChromeVisible(false)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') goPrev()
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') goNext()
      if (e.key === 'Escape') {
        dismissSelection()
        setActiveHighlight(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let startX = 0
    let startY = 0
    let moved = false
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      startX = t.clientX
      startY = t.clientY
      moved = false
    }
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      if (Math.abs(t.clientX - startX) > 12 || Math.abs(t.clientY - startY) > 12) moved = true
    }
    const onEnd = (e: TouchEvent) => {
      if (selectingRef.current || selectionRef.current) return
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.toString().trim()) return
      const t = e.changedTouches[0]
      if (!t || !moved) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      const threshold = 40
      if (Math.abs(dy) > threshold && Math.abs(dy) > Math.abs(dx) * 1.15) {
        if (dy < 0) goNext()
        else goPrev()
        return
      }
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.15) {
        if (dx < 0) goNext()
        else goPrev()
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [totalPages])

  function presentSelection(force = false, pointerClient?: { x: number; y: number } | null) {
    if (!force && selectingRef.current) return
    const textLayerEl = textLayerRef.current
    const viewportEl = containerRef.current
    if (!textLayerEl || !viewportEl) return
    const text = selectionText()
    if (!force && !isIntentionalTextSelection(text, pointerMovePxRef.current)) {
      clearDomSelection()
      return
    }
    const mapped = selectionToPdfLocator(textLayerEl, textDivsRef.current, page)
    if (!mapped) {
      if (!force) clearDomSelection()
      return
    }
    if (!force && !isIntentionalTextSelection(mapped.text, pointerMovePxRef.current)) {
      clearDomSelection()
      return
    }
    if (
      !force &&
      Date.now() - lastPresentAtRef.current < 50 &&
      selectionRef.current?.text === mapped.text
    ) {
      return
    }
    let anchor = isCompactRef.current ? null : rangeToAnchor(mapped.range, viewportEl)
    if (anchor) {
      const ptrClient = pointerClient ?? lastPointerClientRef.current
      const wrapRect = viewportEl.getBoundingClientRect()
      const pointer = ptrClient
        ? pointerToViewport(
            ptrClient.x,
            ptrClient.y,
            wrapRect,
            viewportEl.scrollLeft,
            viewportEl.scrollTop,
          )
        : null
      anchor = withPointer(anchor, pointer)
    }
    const next: PdfSelectionState = { locator: mapped.locator, text: mapped.text, anchor }
    selectionRef.current = next
    lastPresentAtRef.current = Date.now()
    setSelection(next)
    setBasketPage(String(page))
    setActiveHighlight(null)
    if (isCompactRef.current) setChromeVisible(true)
  }

  useEffect(() => {
    const textLayerEl = textLayerRef.current
    if (!textLayerEl) return

    let mobileShowTimer: ReturnType<typeof setTimeout> | null = null

    const onPointerDown = (e: PointerEvent) => {
      selectingRef.current = true
      pointerStartRef.current = { x: e.clientX, y: e.clientY }
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
      pointerMovePxRef.current = 0
      if (!bubbleInteractingRef.current && selectionRef.current) {
        selectionRef.current = null
        setSelection(null)
        setBasketPage('')
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
      if (!pointerStartRef.current) return
      pointerMovePxRef.current = Math.max(
        pointerMovePxRef.current,
        pointerTravel(pointerStartRef.current, e.clientX, e.clientY),
      )
    }
    const restoreDomRange = (saved: Range | null) => {
      if (!saved || !selectionRef.current) return
      try {
        const sel = window.getSelection()
        if (!sel) return
        if (sel.toString().trim()) return
        sel.removeAllRanges()
        sel.addRange(saved)
      } catch {
        /* ignore */
      }
    }
    const finishSelect = (delay: number, client?: { x: number; y: number } | null) => {
      if (client) lastPointerClientRef.current = client
      const run = () => {
        selectingRef.current = false
        // 必须在随后的 click 清掉选区前同步读出 Range
        let saved: Range | null = null
        try {
          const sel = window.getSelection()
          if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
            saved = sel.getRangeAt(0).cloneRange()
          }
        } catch {
          /* ignore */
        }
        presentSelection(false, lastPointerClientRef.current)
        pointerStartRef.current = null
        if (saved) {
          requestAnimationFrame(() => {
            restoreDomRange(saved)
            window.setTimeout(() => restoreDomRange(saved), 0)
            window.setTimeout(() => restoreDomRange(saved), 40)
          })
        }
      }
      if (delay <= 0) run()
      else window.setTimeout(run, delay)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      // 鼠标必须同步弹出：延迟会被随后的 click 抢先清掉选区
      finishSelect(0, { x: e.clientX, y: e.clientY })
    }
    const onPointerCancel = (e: PointerEvent) => {
      finishSelect(0, { x: e.clientX, y: e.clientY })
    }
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches?.[0]
      finishSelect(40, t ? { x: t.clientX, y: t.clientY } : null)
    }
    const onSelectionChange = () => {
      if (bubbleInteractingRef.current) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) return
      if (!textLayerEl.contains(sel.anchorNode)) return
      // 桌面划词中不弹；移动端手柄拖动防抖刷新
      if (!isCompactRef.current) return
      if (selectingRef.current) return
      if (mobileShowTimer) clearTimeout(mobileShowTimer)
      mobileShowTimer = setTimeout(() => {
        mobileShowTimer = null
        presentSelection()
      }, 320)
    }
    const onContextMenu = (e: MouseEvent) => {
      // 让气泡接管，避免系统菜单挡操作（桌面仍可 Cmd/Ctrl+C）
      if (selectionText()) {
        e.preventDefault()
        selectingRef.current = false
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
        presentSelection(true, lastPointerClientRef.current)
      }
    }

    textLayerEl.addEventListener('pointerdown', onPointerDown)
    textLayerEl.addEventListener('pointermove', onPointerMove)
    textLayerEl.addEventListener('pointerup', onPointerUp)
    textLayerEl.addEventListener('pointercancel', onPointerCancel)
    textLayerEl.addEventListener('touchend', onTouchEnd)
    textLayerEl.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      if (mobileShowTimer) clearTimeout(mobileShowTimer)
      textLayerEl.removeEventListener('pointerdown', onPointerDown)
      textLayerEl.removeEventListener('pointermove', onPointerMove)
      textLayerEl.removeEventListener('pointerup', onPointerUp)
      textLayerEl.removeEventListener('pointercancel', onPointerCancel)
      textLayerEl.removeEventListener('touchend', onTouchEnd)
      textLayerEl.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scale, loading])

  function jumpToPage(raw?: string) {
    const n = Number.parseInt((raw ?? pageInput).trim(), 10)
    if (!Number.isFinite(n) || totalPages <= 0) {
      setPageInput(String(page))
      return
    }
    dismissSelection()
    setPage(Math.min(totalPages, Math.max(1, n)))
  }

  function onViewportClick(e: React.MouseEvent<HTMLDivElement>) {
    if (bubbleInteractingRef.current) return
    const target = e.target as HTMLElement
    if (target.closest('.pdf-click-zone')) return
    if (target.closest('.selection-menu') || target.closest('.highlight-popover')) return
    if (target.closest('.textLayer') || target.closest('.pdf-hl')) {
      // 文字层 / 高亮：不翻页
      return
    }
    if (selectionRef.current) {
      dismissSelection()
      return
    }
    if (activeHighlight) {
      setActiveHighlight(null)
      return
    }
    // 左右/上下翻页由透明热区处理；空白处仅用于关闭选区或唤出工具栏
    if (isCompactRef.current) {
      setChromeVisible((v) => !v)
    }
  }

  function suppressZonePointer(e: React.PointerEvent | React.MouseEvent) {
    // 勿 preventDefault：会吞掉后续 click；热区已在文字层之上且 user-select:none
    e.stopPropagation()
    clearDomSelection()
    selectingRef.current = false
    lastPointerClientRef.current = null
    pointerStartRef.current = null
    pointerMovePxRef.current = 0
  }

  function handleZoneClick(action: 'prev' | 'next') {
    clearDomSelection()
    if (selectionRef.current) {
      dismissSelection()
      return
    }
    if (activeHighlight) setActiveHighlight(null)
    if (action === 'prev') goPrev()
    else goNext()
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await shellRef.current?.requestFullscreen()
    } catch {
      toast.error('当前浏览器不支持全屏，或已被拒绝')
    }
  }

  function saveNote(content: string) {
    setNoteContent(content)
    setNoteSaveState('saving')
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current)
    noteSaveTimerRef.current = setTimeout(async () => {
      try {
        await api.put(`/api/notes/${book.id}`, { content })
        setNoteSaveState('saved')
      } catch {
        setNoteSaveState('idle')
      }
    }, 700)
  }

  function dismissSelection() {
    selectionRef.current = null
    setSelection(null)
    setBasketPage('')
    selectingRef.current = false
    lastPointerClientRef.current = null
    pointerStartRef.current = null
    pointerMovePxRef.current = 0
    clearDomSelection()
  }

  async function createHighlight(color: string, note = '') {
    if (!selection) return
    if (!isPdfLocator(selection.locator)) {
      toast.error('未能定位选区，请重新划选后再高亮')
      return
    }
    try {
      const h = await api.post<Highlight>('/api/highlights', {
        book_id: book.id,
        cfi_range: selection.locator,
        color,
        quoted_text: selection.text,
        note,
        page_no: basketPage.trim() || String(page),
        chapter_title: `第 ${page} 页`,
      })
      setHighlights((prev) => [...prev, h])
      toast.success(note ? '已添加笔记并高亮' : '已高亮')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建高亮失败')
    } finally {
      dismissSelection()
    }
  }

  function beginScrubGesture() {
    scrubOriginPendingRef.current = true
  }

  function scrubToPercent(nextPercent: number) {
    if (!totalPages) return
    const nextPage = Math.min(totalPages, Math.max(1, Math.round((nextPercent / 100) * totalPages)))
    if (scrubOriginPendingRef.current) {
      if (nextPage !== currentPageRef.current) pushNavBackPoint()
      scrubOriginPendingRef.current = false
    }
    setPage(nextPage)
  }

  async function addToBasket(targetProjectId?: string) {
    if (!selection) return
    let projectId = targetProjectId || basketProjectId || projects[0]?.id
    if (!projectId) {
      try {
        const created = await api.post<{ id: string; name: string }>('/api/citation/projects', {
          name: '默认引用篮',
        })
        projectId = created.id
        setProjects((prev) => [
          { id: created.id, name: created.name, script_variant: 'simplified', created_at: '' },
          ...prev,
        ])
        setBasketProjectId(created.id)
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '无法创建引用篮项目')
        return
      }
    }
    try {
      const pageNo = basketPage.trim() || String(page)
      await api.post('/api/citation/items', {
        project_id: projectId,
        book_id: book.id,
        quoted_text: selection.text,
        page_no: pageNo,
        cfi_range: selection.locator || `pdf:#page=${page}`,
      })
      toast.success('已加入引用篮')
      dismissSelection()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '存入失败')
    }
  }

  async function addToNewBasket(name: string) {
    if (!selection) return
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('请输入引用篮名称')
      return
    }
    try {
      const created = await api.post<{ id: string; name: string }>('/api/citation/projects', {
        name: trimmed,
      })
      setProjects((prev) => [
        { id: created.id, name: created.name, script_variant: 'simplified', created_at: '' },
        ...prev,
      ])
      setBasketProjectId(created.id)
      await addToBasket(created.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '无法创建引用篮')
    }
  }

  async function copyQuickFootnote() {
    try {
      const pageNo = basketPage.trim() || String(page)
      const params = new URLSearchParams({ book_id: book.id, page_no: pageNo })
      const { text } = await api.get<{ text: string }>(`/api/citation/quick-footnote?${params}`)
      if (!text) {
        toast.error('无法生成脚注，请先完善书籍信息')
        return
      }
      const ok = await copyTextToClipboard(text)
      if (!ok) {
        toast.error('复制失败，请长按选区使用系统复制')
        return
      }
      toast.success('脚注已复制')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '复制脚注失败')
    }
  }

  async function deleteHighlight(h: Highlight) {
    try {
      await api.delete(`/api/highlights/${h.id}`)
      setHighlights((prev) => prev.filter((x) => x.id !== h.id))
      setActiveHighlight(null)
      toast.success('已删除高亮')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  function jumpToHighlight(h: Highlight) {
    const loc = parsePdfLocator(h.cfi_range)
    if (loc) {
      setDrawerTab(null)
      setShowJournal(false)
      if (loc.page !== currentPageRef.current) pushNavBackPoint()
      setPage(loc.page)
      return
    }
    const n = Number.parseInt(h.page_no || '', 10)
    if (Number.isFinite(n) && n >= 1) {
      setDrawerTab(null)
      setShowJournal(false)
      if (n !== currentPageRef.current) pushNavBackPoint()
      setPage(n)
    }
  }

  function openDrawer(tab: 'journal' | 'notes') {
    setDrawerTab(tab)
    setShowJournal(tab === 'journal')
  }

  function renderProgressJump() {
    return (
      <div className="reader-progress-jump" title="输入页码后回车跳转">
        <input
          className="reader-page-input"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => jumpToPage()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
              jumpToPage(e.currentTarget.value)
            }
          }}
          aria-label="跳转到页码"
        />
        <span className="reader-progress-meta">
          / {totalPages || '…'} · {percent}%
        </span>
      </div>
    )
  }

  const pdfHighlights = highlights.filter((h) => isPdfLocator(h.cfi_range) || h.page_no)

  return (
    <div className={`reader-shell${chromeVisible ? '' : ' chrome-hidden'}`} ref={shellRef}>
      <ReaderReturnOriginBar visible={canNavBack} onReturn={goNavBack} onDismiss={clearNavOrigin} />
      <div className="reader-topbar">
        <div className="reader-topbar-left">
          <button className="icon-btn" onClick={() => navigate(-1)} title="返回" aria-label="返回">
            <ArrowLeft size={18} />
          </button>
          <ReaderBookIdentity
            bookId={book.id}
            title={book.title}
            authors={book.authors}
            coverUrl={book.cover_url}
            coverOnly={isCompact}
          />
        </div>

        <div className="reader-topbar-right">
          {!isCompact && (
            <button
              className="icon-btn reader-desktop-only"
              onClick={toggleFullscreen}
              title={isFullscreen ? '退出全屏' : '全屏阅读'}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          )}
          <button
            className="icon-btn reader-zoom-btn"
            onClick={() => changeScale(-0.1)}
            title="缩小"
            aria-label="缩小"
          >
            <Minus size={16} />
          </button>
          <button className="icon-btn reader-zoom-btn" onClick={() => changeScale(0.1)} title="放大" aria-label="放大">
            <Plus size={16} />
          </button>
          <button
            className={`icon-btn ${drawerTab === 'notes' ? 'active' : ''}`}
            onClick={() => {
              if (drawerTab === 'notes') setDrawerTab(null)
              else {
                setShowJournal(false)
                setDrawerTab('notes')
              }
            }}
            title="高亮与笔记"
          >
            <Highlighter size={18} />
          </button>
          <button
            className={`icon-btn ${drawerTab === 'journal' || showJournal ? 'active' : ''}`}
            onClick={() => {
              if (drawerTab === 'journal') {
                setDrawerTab(null)
                setShowJournal(false)
              } else {
                openDrawer('journal')
              }
            }}
            title="写笔记（Markdown）"
          >
            <NotebookPen size={18} />
          </button>
        </div>
      </div>

      <div className="reader-body">
        <div className="reader-viewport pdf-viewport" ref={containerRef} onClick={onViewportClick}>
          {loading && (
            <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>
              <div className="spinner" />
            </div>
          )}
          <div className="pdf-page-wrap">
            <div className="pdf-page" ref={pageRef}>
              <canvas ref={canvasRef} className="pdf-canvas" />
              <div className="textLayer" ref={textLayerRef} />
              <div className="pdf-hl-layer" ref={hlLayerRef}>
                {hlPaints.map((paint) =>
                  paint.rects.map((r, i) => (
                    <div
                      key={`${paint.id}-${i}`}
                      className="pdf-hl"
                      style={{
                        left: r.left,
                        top: r.top,
                        width: r.width,
                        height: r.height,
                        background: paint.color,
                      }}
                      title="点击管理高亮"
                      onClick={(e) => {
                        e.stopPropagation()
                        const box = containerRef.current?.getBoundingClientRect()
                        if (!box) return
                        setActiveHighlight({
                          id: paint.id,
                          x: e.clientX - box.left + (containerRef.current?.scrollLeft || 0),
                          y: e.clientY - box.top + (containerRef.current?.scrollTop || 0),
                        })
                        dismissSelection()
                      }}
                    />
                  )),
                )}
                {flashPaints.map((paint) =>
                  paint.rects.map((r, i) => (
                    <div
                      key={`flash-${paint.id}-${i}`}
                      className="pdf-hl pdf-hl-flash"
                      style={{
                        left: r.left,
                        top: r.top,
                        width: r.width,
                        height: r.height,
                        background: paint.color,
                      }}
                      aria-hidden
                    />
                  )),
                )}
              </div>
            </div>
          </div>
          {!textSelectable && !loading && !noTextHintDismissed && (
            <div className="pdf-no-text-hint" role="status">
              <span className="pdf-no-text-hint-text">本页无文字层，无法划词（扫描版常见）</span>
              <div className="pdf-no-text-hint-actions">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    setDrawerTab('journal')
                    setShowJournal(true)
                    setChromeVisible(true)
                    setNoteContent((prev) => {
                      const stamp = `## 第 ${page} 页\n\n`
                      if (!prev.trim()) return stamp
                      if (prev.includes(`第 ${page} 页`)) return prev
                      return `${prev.replace(/\s*$/, '')}\n\n${stamp}`
                    })
                  }}
                >
                  记本页
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="关闭提示"
                  title="本次阅读不再提示"
                  onClick={() => {
                    setNoTextHintDismissed(true)
                    try {
                      sessionStorage.setItem(noTextHintDismissKey(book.id), '1')
                    } catch {
                      /* private mode */
                    }
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <div
            className="pdf-click-zone left"
            aria-hidden
            onPointerDown={suppressZonePointer}
            onMouseDown={suppressZonePointer}
            onClick={(e) => {
              e.stopPropagation()
              handleZoneClick('prev')
            }}
          />
          <div
            className="pdf-click-zone right"
            aria-hidden
            onPointerDown={suppressZonePointer}
            onMouseDown={suppressZonePointer}
            onClick={(e) => {
              e.stopPropagation()
              handleZoneClick('next')
            }}
          />
          <div
            className="pdf-click-zone top"
            aria-hidden
            onPointerDown={suppressZonePointer}
            onMouseDown={suppressZonePointer}
            onClick={(e) => {
              e.stopPropagation()
              handleZoneClick('prev')
            }}
          />
          <div
            className="pdf-click-zone bottom"
            aria-hidden
            onPointerDown={suppressZonePointer}
            onMouseDown={suppressZonePointer}
            onClick={(e) => {
              e.stopPropagation()
              handleZoneClick('next')
            }}
          />

          {selection && (
            <SelectionBubble
              anchor={selection.anchor}
              text={selection.text}
              pageValue={basketPage}
              onPageChange={setBasketPage}
              pagePlaceholder="页码"
              pageTitle="PDF 页码（可改成纸书页）"
              projects={projects}
              projectId={basketProjectId}
              onProjectChange={setBasketProjectId}
              onHighlight={(c, note) => void createHighlight(c, note)}
              onCopy={async () => {
                const ok = await copyTextToClipboard(selection.text)
                if (ok) toast.success('已复制')
                else toast.error('复制失败，请长按选区使用系统复制')
              }}
              onAddToBasket={() => void addToBasket()}
              onAddToNewBasket={(name) => addToNewBasket(name)}
              onQuickFootnote={() => void copyQuickFootnote()}
              onDismiss={dismissSelection}
              containerWidth={containerRef.current?.clientWidth || 360}
              containerHeight={containerRef.current?.clientHeight || 640}
              interactingRef={bubbleInteractingRef}
            />
          )}

          {activeHighlight && (
            <div
              className="highlight-popover"
              style={{ left: activeHighlight.x, top: activeHighlight.y }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <button
                type="button"
                className="reader-context-item"
                onClick={() => {
                  const h = highlights.find((x) => x.id === activeHighlight.id)
                  if (h) void deleteHighlight(h)
                }}
              >
                删除高亮
              </button>
              <button type="button" className="reader-context-item muted" onClick={() => setActiveHighlight(null)}>
                取消
              </button>
            </div>
          )}
        </div>

        {(drawerTab === 'journal' || showJournal) && (
          <ReaderJournalPanel
            noteContent={noteContent}
            onChange={(v) => saveNote(v)}
            noteSaveState={noteSaveState}
            journalMode={journalMode}
            setJournalMode={setJournalMode}
            onClose={() => {
              setDrawerTab(null)
              setShowJournal(false)
            }}
            paperBg="#f7f3ea"
            paperFg="#2c2a26"
            width={journalWidth}
            onResizePointerDown={onJournalResizePointerDown}
            showResize={!isCompact}
          />
        )}

        {drawerTab === 'notes' && (
          <div className="reader-drawer">
            <div className="reader-drawer-header">
              <div style={{ fontWeight: 700 }}>本书高亮</div>
              <button className="icon-btn" onClick={() => setDrawerTab(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="reader-drawer-list">
              {pdfHighlights.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <div style={{ color: 'var(--ink-faint)', fontSize: 13 }}>划选文字后点色点即可高亮</div>
                </div>
              ) : (
                pdfHighlights.map((h) => {
                  const loc = parsePdfLocator(h.cfi_range)
                  const pageLabel = loc ? `第 ${loc.page} 页` : h.page_no ? `第 ${h.page_no} 页` : '高亮'
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className="reader-note-item"
                      onClick={() => jumpToHighlight(h)}
                    >
                      <span className="reader-note-color" style={{ background: h.color || '#ffd54f' }} />
                      <span className="reader-note-body">
                        <span className="reader-note-meta">{pageLabel}</span>
                        <span className="reader-note-quote">{h.quoted_text || '（无摘录）'}</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div className="reader-bottombar" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="reader-scrubber"
          type="range"
          min={0}
          max={100}
          step={0.2}
          value={Number.isFinite(percent) ? percent : 0}
          onPointerDown={beginScrubGesture}
          onTouchStart={beginScrubGesture}
          onChange={(e) => scrubToPercent(Number(e.target.value))}
          aria-label="阅读进度"
          style={{ ['--scrub-pct' as string]: `${Number.isFinite(percent) ? percent : 0}%` }}
        />
        <div className="reader-bottombar-nav">
          <button type="button" className="icon-btn" onClick={goPrev} disabled={page <= 1} aria-label="上一页">
            <ChevronLeft size={18} />
          </button>
          {renderProgressJump()}
          <button
            type="button"
            className="icon-btn"
            onClick={goNext}
            disabled={!totalPages || page >= totalPages}
            aria-label="下一页"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
