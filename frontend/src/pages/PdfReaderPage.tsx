import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import { chromeSpring } from '../lib/motion'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Languages,
  Maximize,
  Minimize,
  Minus,
  NotebookPen,
  Plus,
  Settings2,
  TextSelect,
  X,
} from 'lucide-react'
import { api, ApiError, getToken } from '../api/client'
import type { BookDetail, BookNote, Highlight } from '../api/types'
import LabSwitch from '../components/LabSwitch'
import ReaderBookIdentity from '../components/ReaderBookIdentity'
import ReaderJournalPanel from '../components/ReaderJournalPanel'
import ReaderReturnOriginBar from '../components/ReaderReturnOriginBar'
import ReaderTranslatePanel from '../components/ReaderTranslatePanel'
import ReaderMidSwipeLayer from '../components/ReaderMidSwipeLayer'
import SelectionBubble from '../components/SelectionBubble'
import { useAuth } from '../contexts/AuthContext'
import { usePinchZoom } from '../hooks/usePinchZoom'
import { useReaderSelectionTranslate } from '../hooks/useReaderSelectionTranslate'
import {
  clampPdfScale,
  clearBookPdfScale,
  computePdfFitScale,
  loadBookPdfScale,
  saveBookPdfScale,
} from '../lib/pdfScale'
import { isAppleTouchDevice } from '../lib/platform'
import { isReaderPinchBlocking, markTouchGestureMulti } from '../lib/readerGestureGate'
import { copyTextToClipboard } from '../lib/clipboard'
import { useReaderAnnotateMode } from '../hooks/useReaderAnnotateMode'
import { useReaderCitationBasket } from '../hooks/useReaderCitationBasket'
import { type SelectionAnchor } from '../lib/readerConstants'
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
import {
  noTextHintDismissKey,
  noTextToastKey,
  pageHasSelectableText,
} from '../lib/pdfTextLayer'
import { pdfPersistableLocator } from '../lib/readerSelection'
import { findKeywordRanges } from '../lib/findKeywordRanges'
import { highlightTerms } from '../lib/highlightQuery'
import {
  resolveHorizontalSwipe,
  resolveHorizontalSwipeByTravel,
  SWIPE_AXIS_RATIO_COMPACT,
  SWIPE_INTENT_PX,
  SWIPE_THRESHOLD_COMPACT_PX,
} from '../lib/readerPageTurnGestures'
import {
  clearDomSelection,
  isAccidentalTapSelection,
  pointerTravel,
  selectionText,
} from '../lib/readerGestures'
import { pointerToViewport, rangeToScreenBounds, withPointer } from '../lib/selectionBubblePlacement'
import { exitReader } from '../lib/exitReader'
import { isReaderPeekMode } from '../lib/readerDeepLink'
import { useReaderChromeInset } from '../lib/useReaderChromeInset'
import { useReaderExitBackGesture } from '../hooks/useReaderExitBackGesture'

import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorker

/** nginx 若把 .mjs 当成 octet-stream，模块 Worker 会静默失败；用 JS MIME 的 Blob URL 兜底 */
let pdfWorkerReady: Promise<void> | null = null
function ensurePdfWorker(): Promise<void> {
  if (!pdfWorkerReady) {
    pdfWorkerReady = (async () => {
      try {
        const res = await fetch(pdfWorker)
        if (!res.ok) return
        const buf = await res.arrayBuffer()
        const url = URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }))
        GlobalWorkerOptions.workerSrc = url
      } catch {
        GlobalWorkerOptions.workerSrc = pdfWorker
      }
    })()
  }
  return pdfWorkerReady
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
  /** true=抑制进度写入（引用/搜索等 peek 深链）；翻页或指定页码后改为 false */
  const suppressProgressSaveRef = useRef(false)
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderTokenRef = useRef(0)
  const selectionRef = useRef<PdfSelectionState | null>(null)
  const bubbleInteractingRef = useRef(false)
  const selectingRef = useRef(false)
  const selectStartedAtRef = useRef(0)
  const lastSelectionActivityAtRef = useRef(0)
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const lastPresentAtRef = useRef(0)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const pointerMovePxRef = useRef(0)
  const isCompactRef = useRef(false)
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia('(max-width: 860px)').matches ||
      window.matchMedia('(pointer: coarse)').matches
    )
  })

  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const currentPageRef = useRef(1)
  const navStackRef = useRef<number[]>([])
  const [canNavBack, setCanNavBack] = useState(false)
  /** 进度条一次拖动只压栈一次 */
  const scrubOriginPendingRef = useRef(false)
  const [totalPages, setTotalPages] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  /** 有按书记忆则用记忆；否则等容器就绪后自适应，scaleReady 前不渲染页 */
  const [scale, setScale] = useState(() => loadBookPdfScale(book.id) ?? 1)
  const [scaleReady, setScaleReady] = useState(() => loadBookPdfScale(book.id) != null)
  const scaleRef = useRef(scale)
  /** 放大后内容超出视口：需单指拖动，卸掉中部翻页层/左右热区 */
  const [canPan, setCanPan] = useState(false)
  const canPanRef = useRef(false)
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])
  useEffect(() => {
    canPanRef.current = canPan
  }, [canPan])

  // 移动端放大可拖时固定显示顶/底栏（中部点按层已卸掉，否则栏藏了唤不回）
  useEffect(() => {
    if (canPan && isCompact) setChromeVisible(true)
  }, [canPan, isCompact])
  const suppressChromeToggleRef = useRef(false)
  const lastContentTapRef = useRef({ t: 0, x: 0, y: 0 })
  /** 跨屏时 DPR 变化需重绘，否则仍糊 */
  const [pixelRatioTick, setPixelRatioTick] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [wheelPageTurn, setWheelPageTurn] = useState(true)
  const wheelEnabledRef = useRef(true)
  const lastWheelAtRef = useRef(0)
  const [showJournal, setShowJournal] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'journal' | 'notes' | 'translate' | null>(null)
  const [showPdfSettings, setShowPdfSettings] = useState(false)
  const [noteContent, setNoteContent] = useState('')
  const [noteSaveState, setNoteSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [journalMode, setJournalMode] = useState<'edit' | 'preview'>('edit')
  const [chromeVisible, setChromeVisible] = useState(true)
  const reduceMotion = useReducedMotion()
  const [selection, setSelection] = useState<PdfSelectionState | null>(null)
  const autoTranslate = user?.preferences?.reader_auto_translate !== false
  const {
    bubble: translateBubble,
    panel: translatePanel,
    translateNow,
    openPanelFromBubble,
    askExplain,
  } = useReaderSelectionTranslate(selection?.text, autoTranslate)
  const basketPageRef = useRef('')
  const {
    projects,
    basketProjectId,
    setBasketProjectId,
    basketPage,
    setBasketPage,
    loadProjects,
    addToBasket: addToBasketCore,
    addToNewBasket: addToNewBasketCore,
    copyQuickFootnote,
  } = useReaderCitationBasket({
    bookId: book.id,
    resolvePageNo: () => basketPageRef.current.trim() || String(currentPageRef.current),
  })
  useEffect(() => {
    basketPageRef.current = basketPage
  }, [basketPage])
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
  useReaderExitBackGesture(shellRef, navigate, isCompact)
  const { width: journalWidth, onResizePointerDown: onJournalResizePointerDown } = useJournalDrawerWidth()

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === shellRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => {
    // 退出全屏也必须把顶/底栏找回来，否则会像 EPUB 阅读器一样"栏消失了"
    setChromeVisible(!isFullscreen)
  }, [isFullscreen])

  useEffect(() => {
    const mqWidth = window.matchMedia('(max-width: 860px)')
    const mqTouch = window.matchMedia('(pointer: coarse)')
    const sync = () => {
      const compact = mqWidth.matches || mqTouch.matches
      isCompactRef.current = compact
      setIsCompact(compact)
    }
    sync()
    mqWidth.addEventListener('change', sync)
    mqTouch.addEventListener('change', sync)
    return () => {
      mqWidth.removeEventListener('change', sync)
      mqTouch.removeEventListener('change', sync)
    }
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
    void loadProjects()
    api
      .get<Highlight[]>(`/api/highlights/book/${book.id}`)
      .then(setHighlights)
      .catch(() => {})
  }, [book.id, loadProjects])

  function clearPinchPreview() {
    const el = pageRef.current
    if (!el) return
    el.classList.remove('is-pinching')
    el.style.transform = ''
    el.style.willChange = ''
  }

  function persistPdfScale(next: number) {
    const clamped = clampPdfScale(next)
    scaleRef.current = clamped
    setScale(clamped)
    setScaleReady(true)
    saveBookPdfScale(book.id, clamped)
    return clamped
  }

  function changeScale(delta: number) {
    persistPdfScale(scaleRef.current + delta)
  }

  /** 双击内容区：清记忆缩放并回到视口自适应 */
  async function resetToFitScale() {
    clearPinchPreview()
    dismissSelection()
    setActiveHighlight(null)
    setChromeVisible(true)
    clearBookPdfScale(book.id)
    const box = containerRef.current
    const pdf = pdfRef.current
    if (!box || !pdf) {
      setScaleReady(false)
      return
    }
    const next = await computePdfFitScale(
      pdf,
      box.clientWidth,
      box.clientHeight,
      currentPageRef.current || 1,
    )
    const changed = Math.abs(next - scaleRef.current) > 0.02 || canPanRef.current
    scaleRef.current = next
    setScale(next)
    setScaleReady(true)
    box.scrollLeft = 0
    box.scrollTop = 0
    canPanRef.current = false
    setCanPan(false)
    if (changed) {
      toast.message('已恢复自适应尺寸', { duration: 1400, id: 'pdf-fit' })
    }
  }

  // 换书：有记忆直接用；无记忆等自适应
  useEffect(() => {
    const remembered = loadBookPdfScale(book.id)
    if (remembered != null) {
      scaleRef.current = remembered
      setScale(remembered)
      setScaleReady(true)
    } else {
      scaleRef.current = 1
      setScale(1)
      setScaleReady(false)
    }
  }, [book.id])

  // 新书无记忆：按当前页适配视口（整页 contain）；容器未布局完时用 ResizeObserver 重试
  useEffect(() => {
    if (loading || scaleReady || !pdfRef.current) return
    const el = containerRef.current
    if (!el) return
    let cancelled = false

    async function resolveFit() {
      if (cancelled || !pdfRef.current) return
      const box = containerRef.current
      if (!box || box.clientWidth < 40 || box.clientHeight < 40) return
      const remembered = loadBookPdfScale(book.id)
      const next =
        remembered ??
        (await computePdfFitScale(
          pdfRef.current,
          box.clientWidth,
          box.clientHeight,
          currentPageRef.current || 1,
        ))
      if (cancelled) return
      scaleRef.current = next
      setScale(next)
      setScaleReady(true)
      // 自适应不落盘；只有用户手动调过才记忆
    }

    void resolveFit()
    const ro = new ResizeObserver(() => {
      void resolveFit()
    })
    ro.observe(el)
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [loading, scaleReady, book.id, totalPages])

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
      suppressProgressSaveRef.current = false
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
        await ensurePdfWorker()
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
        suppressProgressSaveRef.current = isReaderPeekMode(searchParams)
        if (restart) {
          suppressProgressSaveRef.current = false
          setPage(1)
        } else if (fromCfi) {
          // 搜索/高亮深链优先于阅读进度；peek 模式下不写回进度
          setPage(clamp(fromCfi))
        } else {
          // location 为页码；若缺失/失效，用已存百分比换算，避免「继续阅读 26% 却从第 1 页开」
          const savedPage = Number.parseInt(String(progress.location || '').trim(), 10)
          const rawPct = Number(progress.percent) || 0
          const savedPct = rawPct > 1.5 ? rawPct / 100 : rawPct
          let startPage = 1
          if (Number.isFinite(savedPage) && savedPage >= 1 && savedPage <= pdf.numPages) {
            startPage = savedPage
          } else if (savedPct >= 0.005 && pdf.numPages > 0) {
            startPage = clamp(Math.max(1, Math.round(savedPct * pdf.numPages)))
          }
          setPage(startPage)
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error && err.message
                ? `打开 PDF 失败：${err.message}`
                : '打开 PDF 失败'
          toast.error(msg)
          console.error('[PdfReader] open failed', err)
        }
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
      suppressProgressSaveRef.current = false
      setPage(1)
      return
    }
    const fromCfi = pdfTargetPage(searchParams.get('cfi') || '')
    if (!fromCfi) return
    // 会话中再次被引用/搜索定位：暂不改进度
    suppressProgressSaveRef.current = true
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

        // HiDPI：按 devicePixelRatio 提高 canvas 像素密度，避免网页/手机发糊
        const cssViewport = pdfPage.getViewport({ scale })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 3)
        const viewport =
          pixelRatio === 1
            ? cssViewport
            : pdfPage.getViewport({ scale: scale * pixelRatio })
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) return
        const cssW = Math.floor(cssViewport.width)
        const cssH = Math.floor(cssViewport.height)
        // 先清 pinch 预览再改布局，避免「新尺寸 × CSS scale」叠成过大；旧位图会短暂拉伸过渡
        clearPinchPreview()
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${cssW}px`
        canvas.style.height = `${cssH}px`
        pageEl.style.width = `${cssW}px`
        pageEl.style.height = `${cssH}px`
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'

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

        // 文字层按 CSS 像素对齐（与 canvas 显示尺寸一致，不乘 DPR）
        textLayerEl.style.width = `${cssW}px`
        textLayerEl.style.height = `${cssH}px`
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport: cssViewport,
        })
        textLayerInstRef.current = textLayer
        await textLayer.render()
        if (token !== renderTokenRef.current) return
        textDivsRef.current = textLayer.textDivs
        paintHighlightsForPage(page, textLayer.textDivs, pageEl)
        // 文字层就绪后再闪搜索命中（首页/全库检索深链）
        applyPdfSearchFlash(true)

        if (suppressProgressSaveRef.current) return
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          if (suppressProgressSaveRef.current) return
          api
            .put(`/api/books/${book.id}/progress`, {
              location: String(page),
              percent: totalPages > 0 ? page / totalPages : 0,
            })
            .catch(() => {})
        }, 600)

      } catch {
        clearPinchPreview()
        // 翻页竞态时忽略
      }
    }
    if (!loading && scaleReady) void renderPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scale, loading, scaleReady, book.id, totalPages, pixelRatioTick])

  // 高亮列表变化后重绘当前页
  useEffect(() => {
    const pageEl = pageRef.current
    if (!pageEl || !textDivsRef.current.length) return
    paintHighlightsForPage(page, textDivsRef.current, pageEl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, page])

  const goPrevRef = useRef<() => void>(() => {})
  const goNextRef = useRef<() => void>(() => {})
  const lastPageTurnAtRef = useRef(0)
  const mobilePresentRef = useRef<() => boolean>(() => false)
  const lastSwipeAtRef = useRef(0)
  const {
    midSelectMode,
    setMidSelectMode,
    midSelectPinnedRef,
    enterAnnotateMode,
    toggleAnnotateMode,
  } = useReaderAnnotateMode({
    hasSelection: Boolean(selection),
    isCompact,
    onSelectionShowChrome: () => setChromeVisible(true),
  })

  const [selectionChromeEl, setSelectionChromeEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isCompact) return
    if (!midSelectMode && !selection) return
    const quietMs = isAppleTouchDevice() ? 900 : 700
    const tick = () => {
      if (Date.now() - lastSwipeAtRef.current < 400) return
      if (selectionRef.current) {
        const live = selectionText()
        if (live) {
          lastSelectionActivityAtRef.current = Date.now()
          if (live !== selectionRef.current.text) {
            selectingRef.current = false
            // 通过 mobilePresent 强制刷新（内部 presentSelection）
            mobilePresentRef.current()
          }
          return
        }
        if (Date.now() - lastPresentAtRef.current < 280) return
        bubbleInteractingRef.current = false
        // 安静轮询清选区：保留顶栏钉住的划词模式（iOS 拖手柄时选区会瞬空）
        dismissSelection({ keepAnnotate: true })
        return
      }
      if (Date.now() - lastSelectionActivityAtRef.current < quietMs) return
      mobilePresentRef.current()
    }
    const id = window.setInterval(tick, 280)
    return () => window.clearInterval(id)
  }, [isCompact, midSelectMode, selection])

  function applyPageTurn(nextPage: number) {
    dismissSelection()
    setActiveHighlight(null)
    midSelectPinnedRef.current = false
    setMidSelectMode(false)
    suppressProgressSaveRef.current = false
    setPage(nextPage)
    // 放大可拖时栏须常显，否则中部点按层已卸掉，藏了唤不回
    if (isCompactRef.current && !canPanRef.current) setChromeVisible(false)
  }

  function goPrev() {
    if (isReaderPinchBlocking()) return
    const now = Date.now()
    if (now - lastPageTurnAtRef.current < 280) return
    lastPageTurnAtRef.current = now
    dismissSelection()
    applyPageTurn(Math.max(1, page - 1))
  }
  function goNext() {
    if (isReaderPinchBlocking()) return
    const now = Date.now()
    if (now - lastPageTurnAtRef.current < 280) return
    lastPageTurnAtRef.current = now
    dismissSelection()
    applyPageTurn(Math.min(totalPages || page, page + 1))
  }
  goPrevRef.current = goPrev
  goNextRef.current = goNext

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

  // 缩放/换页后：内容是否超出视口 → 进入可拖动态
  useEffect(() => {
    const el = containerRef.current
    if (!el || loading || !scaleReady) {
      setCanPan(false)
      canPanRef.current = false
      return
    }
    let raf = 0
    const check = () => {
      const next =
        el.scrollWidth > el.clientWidth + 8 || el.scrollHeight > el.clientHeight + 8
      canPanRef.current = next
      setCanPan(next)
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(check)
      })
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [scale, page, loading, scaleReady])

  // 进入可拖 / 换页时水平居中一次；捏合改 scale 时勿重置，否则刚拖到的位置会被拉回
  useEffect(() => {
    if (!canPan) return
    const el = containerRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      const maxX = el.scrollWidth - el.clientWidth
      if (maxX > 0) el.scrollLeft = maxX / 2
    })
    return () => cancelAnimationFrame(id)
  }, [canPan, page])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let startX = 0
    let startY = 0
    let maxAbsDx = 0
    let maxAbsDy = 0
    let peakDx = 0
    let multiTouch = false
    const swipeOpts = () =>
      isCompactRef.current
        ? { threshold: SWIPE_THRESHOLD_COMPACT_PX, axisRatio: SWIPE_AXIS_RATIO_COMPACT }
        : undefined
    const onStart = (e: TouchEvent) => {
      if (e.touches.length >= 2 || isReaderPinchBlocking()) {
        multiTouch = true
        markTouchGestureMulti()
        return
      }
      multiTouch = false
      const t = e.touches[0]
      if (!t) return
      startX = t.clientX
      startY = t.clientY
      maxAbsDx = 0
      maxAbsDy = 0
      peakDx = 0
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 || isReaderPinchBlocking()) {
        multiTouch = true
        markTouchGestureMulti()
        return
      }
      if (multiTouch) return
      // 放大可拖动：绝不能 preventDefault，否则视口滚不动
      if (canPanRef.current) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      maxAbsDx = Math.max(maxAbsDx, Math.abs(dx))
      maxAbsDy = Math.max(maxAbsDy, Math.abs(dy))
      if (Math.abs(dx) >= Math.abs(peakDx)) peakDx = dx
      // 已有选区时用户可能在拖手柄，绝不清选区
      if (selectionText() || selectionRef.current) return
      // 中部明确横滑：清掉误触选区，避免划词逻辑吞掉翻页
      if (
        isCompactRef.current &&
        maxAbsDx >= SWIPE_INTENT_PX &&
        maxAbsDx > maxAbsDy * SWIPE_AXIS_RATIO_COMPACT
      ) {
        const rect = el.getBoundingClientRect()
        const xRatio = (startX - rect.left) / Math.max(1, rect.width)
        if (xRatio >= 0.14 && xRatio <= 0.86) {
          clearDomSelection()
          selectingRef.current = false
          lastSelectionActivityAtRef.current = 0
          if (e.cancelable) e.preventDefault()
        }
      }
    }
    const onEnd = (e: TouchEvent) => {
      if (!isCompactRef.current) return
      if (canPanRef.current) return
      if (multiTouch || e.touches.length >= 1 || isReaderPinchBlocking()) {
        if (e.touches.length === 0) multiTouch = false
        return
      }
      const t = e.changedTouches[0]
      if (!t) return
      const rect = el.getBoundingClientRect()
      const xRatio = (startX - rect.left) / Math.max(1, rect.width)
      // 左右边缘留给点击热区，中部滑动翻页
      if (xRatio < 0.14 || xRatio > 0.86) return
      const byEnd = resolveHorizontalSwipe(
        { clientX: startX, clientY: startY },
        { clientX: t.clientX, clientY: t.clientY },
        swipeOpts(),
      )
      const byTravel = resolveHorizontalSwipeByTravel(peakDx, maxAbsDx, maxAbsDy, swipeOpts())
      const dir = byEnd.direction || byTravel.direction
      if (!dir) return
      // 已有稳定选区时优先留给调手柄，不翻页
      if (selectionText() || selectionRef.current) return
      // 明确横滑时优先翻页（即使过程中短暂选出了字）
      clearDomSelection()
      selectingRef.current = false
      lastSelectionActivityAtRef.current = 0
      if (dir === 'next') goNextRef.current()
      else goPrevRef.current()
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [])

  function presentSelection(force = false, pointerClient?: { x: number; y: number } | null): boolean {
    if (!force && selectingRef.current) return false
    const textLayerEl = textLayerRef.current
    const viewportEl = containerRef.current
    if (!textLayerEl || !viewportEl) return false
    const text = selectionText()
    const gestureMs = selectStartedAtRef.current ? Date.now() - selectStartedAtRef.current : undefined
    if (!force && isAccidentalTapSelection(text, pointerMovePxRef.current, gestureMs)) {
      clearDomSelection()
      return false
    }
    const mapped = selectionToPdfLocator(textLayerEl, textDivsRef.current, page)
    if (!mapped) {
      // 扩选过程中 locator 偶发解析失败：保留 DOM 选区，勿清
      return false
    }
    if (!force && isAccidentalTapSelection(mapped.text, pointerMovePxRef.current, gestureMs)) {
      clearDomSelection()
      return false
    }
    if (
      !force &&
      Date.now() - lastPresentAtRef.current < 50 &&
      selectionRef.current?.text === mapped.text
    ) {
      return true
    }
    let anchor = rangeToAnchor(mapped.range, viewportEl)
    const screen = rangeToScreenBounds(mapped.range, null)
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
      if (anchor && screen) anchor = { ...anchor, screen }
    } else if (screen) {
      anchor = {
        x: screen.midX,
        y: screen.top,
        height: Math.max(18, screen.bottom - screen.top),
        screen,
      }
    }
    const next: PdfSelectionState = { locator: mapped.locator, text: mapped.text, anchor }
    selectionRef.current = next
    lastPresentAtRef.current = Date.now()
    if (isCompactRef.current) setChromeVisible(true)
    setSelection(next)
    setBasketPage(String(page))
    setActiveHighlight(null)
    return true
  }

  useEffect(() => {
    const textLayerEl = textLayerRef.current
    if (!textLayerEl) return

    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const SELECTION_SETTLE_MS = 520
    const clearSettleTimer = () => {
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
    }
    const dismissBubble = () => {
      if (!selectionRef.current) return
      selectionRef.current = null
      setSelection(null)
      setBasketPage('')
      selectingRef.current = false
      bubbleInteractingRef.current = false
      lastSelectionActivityAtRef.current = 0
      if (!midSelectPinnedRef.current) setMidSelectMode(false)
    }
    let touchStartX = 0
    let touchStartY = 0
    let touchMaxAbsDx = 0
    let touchMaxAbsDy = 0
    let touchPeakDx = 0
    let lastSwipeAt = 0
    const swipeOpts = () =>
      isCompactRef.current
        ? { threshold: SWIPE_THRESHOLD_COMPACT_PX, axisRatio: SWIPE_AXIS_RATIO_COMPACT }
        : undefined
    const tryPresentSelection = (retriesLeft: number): boolean => {
      if (Date.now() - lastSwipeAt < 400) return false
      const text = selectionText()
      if (text) {
        selectingRef.current = false
        return presentSelection(true, lastPointerClientRef.current)
      }
      if (retriesLeft > 0) {
        window.setTimeout(() => tryPresentSelection(retriesLeft - 1), 80)
      }
      return false
    }
    mobilePresentRef.current = () => tryPresentSelection(0)

    const scheduleSettledPresent = () => {
      clearSettleTimer()
      if (Date.now() - lastSwipeAt < 400) return
      if (isCompactRef.current) {
        const settleMs = isAppleTouchDevice() ? 880 : 680
        settleTimer = setTimeout(() => {
          settleTimer = null
          if (bubbleInteractingRef.current) return
          if (Date.now() - lastSwipeAt < 400) return
          const quiet = Date.now() - lastSelectionActivityAtRef.current
          if (quiet < settleMs - 40) {
            scheduleSettledPresent()
            return
          }
          selectingRef.current = false
          if (!tryPresentSelection(0)) tryPresentSelection(10)
        }, settleMs)
        return
      }
      const snapshot = selectionText()
      if (!snapshot) return
      settleTimer = setTimeout(() => {
        settleTimer = null
        if (selectingRef.current) return
        if (bubbleInteractingRef.current) return
        if (Date.now() - lastSwipeAt < 400) return
        selectingRef.current = false
        presentSelection(true, lastPointerClientRef.current)
      }, SELECTION_SETTLE_MS)
    }

    const onPointerDown = (e: PointerEvent) => {
      selectingRef.current = true
      selectStartedAtRef.current = Date.now()
      pointerStartRef.current = { x: e.clientX, y: e.clientY }
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
      pointerMovePxRef.current = 0
      clearSettleTimer()
      if (bubbleInteractingRef.current) return
      // 移动端功能条在底栏：拖动手柄时保留，避免选区被拆掉重建
      if (isCompactRef.current) return
      dismissBubble()
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
    const syncOrPresentAfterTouch = () => {
      if (!isCompactRef.current) {
        scheduleSettledPresent()
        return
      }
      if (selectionText()) {
        presentSelection(true, lastPointerClientRef.current)
        return
      }
      if (selectionRef.current) {
        dismissBubble()
        return
      }
      scheduleSettledPresent()
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        selectingRef.current = false
        lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
        syncOrPresentAfterTouch()
        return
      }
      // 鼠标必须同步弹出：延迟会被随后的 click 抢先清掉选区
      finishSelect(0, { x: e.clientX, y: e.clientY })
    }
    const onPointerCancel = (e: PointerEvent) => {
      selectingRef.current = false
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
      if (isCompactRef.current) {
        syncOrPresentAfterTouch()
        return
      }
      finishSelect(0, { x: e.clientX, y: e.clientY })
    }
    let touchMulti = false
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2 || isReaderPinchBlocking()) {
        touchMulti = true
        markTouchGestureMulti()
        return
      }
      touchMulti = false
      const t = e.touches?.[0]
      if (!t) return
      touchStartX = t.clientX
      touchStartY = t.clientY
      touchMaxAbsDx = 0
      touchMaxAbsDy = 0
      touchPeakDx = 0
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 || isReaderPinchBlocking()) {
        touchMulti = true
        markTouchGestureMulti()
        return
      }
      if (touchMulti) return
      const t = e.touches?.[0]
      if (!t) return
      const dx = t.clientX - touchStartX
      const dy = t.clientY - touchStartY
      touchMaxAbsDx = Math.max(touchMaxAbsDx, Math.abs(dx))
      touchMaxAbsDy = Math.max(touchMaxAbsDy, Math.abs(dy))
      if (Math.abs(dx) >= Math.abs(touchPeakDx)) touchPeakDx = dx
      // 已有选区 / 气泡已开：用户在拖手柄，绝不清选区、不 preventDefault
      if (selectionText() || selectionRef.current) return
      // 放大拖动画布：不拦截，交给视口滚动
      if (canPanRef.current) return
      if (
        isCompactRef.current &&
        touchMaxAbsDx >= SWIPE_INTENT_PX &&
        touchMaxAbsDx > touchMaxAbsDy * SWIPE_AXIS_RATIO_COMPACT
      ) {
        clearDomSelection()
        selectingRef.current = false
        lastSelectionActivityAtRef.current = 0
        if (e.cancelable) e.preventDefault()
      }
    }
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches?.[0]
      const ptr = t ? { x: t.clientX, y: t.clientY } : null
      if (ptr) lastPointerClientRef.current = ptr
      selectingRef.current = false
      if (touchMulti || e.touches.length >= 1 || isReaderPinchBlocking()) {
        if (e.touches.length === 0) touchMulti = false
        return
      }
      // 放大拖动画布：不翻页
      if (canPanRef.current) return
      // 已有选区或正在调手柄：绝不当成翻页
      if (selectionText() || selectionRef.current) {
        syncOrPresentAfterTouch()
        return
      }
      // 明确横滑：优先翻页（划过文字时浏览器常会短暂出选区）
      if (t) {
        const byEnd = resolveHorizontalSwipe(
          { clientX: touchStartX, clientY: touchStartY },
          { clientX: t.clientX, clientY: t.clientY },
          swipeOpts(),
        )
        const byTravel = resolveHorizontalSwipeByTravel(
          touchPeakDx,
          touchMaxAbsDx,
          touchMaxAbsDy,
          swipeOpts(),
        )
        const dir = byEnd.direction || byTravel.direction
        if (dir) {
          clearSettleTimer()
          clearDomSelection()
          dismissBubble()
          lastSelectionActivityAtRef.current = 0
          lastSwipeAt = Date.now()
          lastSwipeAtRef.current = lastSwipeAt
          e.stopPropagation()
          if (dir === 'next') goNextRef.current()
          else goPrevRef.current()
          return
        }
      }
      // 已有选区 / 刚划过词：只出功能面板
      scheduleSettledPresent()
    }
    let clearTimer: ReturnType<typeof setTimeout> | null = null
    const onSelectionChange = () => {
      if (bubbleInteractingRef.current) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        clearSettleTimer()
        // 取消选中必须关掉气泡；刚弹出时系统可能瞬间清空，延迟到 keep 窗口后再确认
        if (!selectionRef.current) return
        if (clearTimer) clearTimeout(clearTimer)
        const keepMs = isAppleTouchDevice() ? 360 : 220
        const age = Date.now() - lastPresentAtRef.current
        const delay = Math.max(100, keepMs - age + 30)
        clearTimer = setTimeout(() => {
          clearTimer = null
          if (selectionText()) return
          bubbleInteractingRef.current = false
          dismissBubble()
        }, delay)
        return
      }
      if (!textLayerEl.contains(sel.anchorNode)) return
      const text = sel.toString().trim()
      if (!text) return
      if (clearTimer) {
        clearTimeout(clearTimer)
        clearTimer = null
      }
      lastSelectionActivityAtRef.current = Date.now()
      if (!selectStartedAtRef.current) selectStartedAtRef.current = Date.now()
      if (isCompactRef.current) {
        // 底栏已开：拖动手柄时立刻同步全文
        if (selectionRef.current) {
          if (selectionRef.current.text !== text) {
            presentSelection(true, lastPointerClientRef.current)
          }
        } else {
          scheduleSettledPresent()
        }
        return
      }
      if (selectingRef.current) {
        dismissBubble()
        return
      }
      if (selectionRef.current && selectionRef.current.text !== text) {
        dismissBubble()
      }
      scheduleSettledPresent()
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
    textLayerEl.addEventListener('touchstart', onTouchStart, { passive: true })
    textLayerEl.addEventListener('touchmove', onTouchMove, { passive: false })
    textLayerEl.addEventListener('touchend', onTouchEnd)
    textLayerEl.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      clearSettleTimer()
      if (clearTimer) clearTimeout(clearTimer)
      textLayerEl.removeEventListener('pointerdown', onPointerDown)
      textLayerEl.removeEventListener('pointermove', onPointerMove)
      textLayerEl.removeEventListener('pointerup', onPointerUp)
      textLayerEl.removeEventListener('pointercancel', onPointerCancel)
      textLayerEl.removeEventListener('touchstart', onTouchStart)
      textLayerEl.removeEventListener('touchmove', onTouchMove)
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
    suppressProgressSaveRef.current = false
    setPage(Math.min(totalPages, Math.max(1, n)))
  }

  function onViewportClick(e: React.MouseEvent<HTMLDivElement>) {
    if (bubbleInteractingRef.current) return
    if (selectingRef.current) return
    // 选区刚变化：忽略合成 click，避免长选区被清掉
    if (Date.now() - lastSelectionActivityAtRef.current < 1200) return
    const presentGuardMs = isAppleTouchDevice() ? 1400 : 800
    if (Date.now() - lastPresentAtRef.current < presentGuardMs) return
    const target = e.target as HTMLElement
    if (target.closest('.pdf-click-zone')) return
    if (target.closest('.selection-apple') || target.closest('.highlight-popover')) return
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
      if (suppressChromeToggleRef.current) {
        suppressChromeToggleRef.current = false
        return
      }
      if (canPanRef.current) {
        setChromeVisible(true)
        return
      }
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

  function dismissSelection(opts?: { keepAnnotate?: boolean }) {
    selectionRef.current = null
    setSelection(null)
    setBasketPage('')
    selectingRef.current = false
    bubbleInteractingRef.current = false
    lastPointerClientRef.current = null
    pointerStartRef.current = null
    pointerMovePxRef.current = 0
    lastSelectionActivityAtRef.current = 0
    selectStartedAtRef.current = 0
    clearDomSelection()
    if (opts?.keepAnnotate) {
      if (!midSelectPinnedRef.current) setMidSelectMode(false)
      return
    }
    midSelectPinnedRef.current = false
    setMidSelectMode(false)
  }

  useEffect(() => {
    const onResize = () => setPixelRatioTick((n) => n + 1)
    window.addEventListener('resize', onResize)
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    const onDpr = () => setPixelRatioTick((n) => n + 1)
    mq.addEventListener?.('change', onDpr)
    return () => {
      window.removeEventListener('resize', onResize)
      mq.removeEventListener?.('change', onDpr)
    }
  }, [])

  usePinchZoom(containerRef, {
    enabled: isCompact && !loading && scaleReady,
    previewOnly: true,
    getValue: () => scaleRef.current,
    setValue: (next) => {
      const prev = scaleRef.current
      persistPdfScale(next)
      // 几乎没变时直接清预览；有变化则等 render 完成再清
      if (Math.abs(next - prev) < 0.02) clearPinchPreview()
    },
    onPreview: (factor) => {
      const el = pageRef.current
      if (!el) return
      el.classList.add('is-pinching')
      el.style.willChange = 'transform'
      el.style.transformOrigin = 'top center'
      el.style.transform = `scale(${factor})`
    },
    min: 0.6,
    max: 2.5,
    step: 0.05,
    onPinchStart: () => {
      midSelectPinnedRef.current = false
      setMidSelectMode(false)
      dismissSelection()
      if (isCompactRef.current) setChromeVisible(true)
    },
    onPinchEnd: () => {
      if (isCompactRef.current) setChromeVisible(true)
      // 松手后若仍卡着 CSS 预览，下一帧 render 会清；这里再兜一次
      window.setTimeout(() => {
        const el = containerRef.current
        if (!el) return
        const next =
          el.scrollWidth > el.clientWidth + 8 || el.scrollHeight > el.clientHeight + 8
        canPanRef.current = next
        setCanPan(next)
        if (next && isCompactRef.current) setChromeVisible(true)
      }, 80)
    },
  })

  // 移动端双击内容区 → 恢复自适应尺寸
  // 放大可拖时 touchend/pointerup 常被滚动打断；在第二次 touchstart 判定更稳
  useEffect(() => {
    if (!isCompact) return
    const el = containerRef.current
    if (!el) return
    let downX = 0
    let downY = 0
    let moved = false
    let armTap = false

    const ignoreTarget = (t: EventTarget | null) => {
      if (!(t instanceof Element)) return true
      return !!t.closest(
        '.pdf-click-zone, .selection-apple, .highlight-popover, button, a, input, textarea',
      )
    }

    const clearArmed = () => {
      armTap = false
      moved = false
      lastContentTapRef.current = { t: 0, x: 0, y: 0 }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        clearArmed()
        return
      }
      if (isReaderPinchBlocking()) return
      if (selectingRef.current || selectionRef.current) return
      if (bubbleInteractingRef.current) return
      if (ignoreTarget(e.target)) return

      const t = e.touches[0]
      const now = Date.now()
      const prev = lastContentTapRef.current
      const dt = now - prev.t
      const dist = Math.hypot(t.clientX - prev.x, t.clientY - prev.y)
      const maxDt = canPanRef.current ? 450 : 340
      const maxDist = canPanRef.current ? 80 : 48

      // 第二次按下即视为双击（不依赖第一次 touchend 是否被滚动吞掉）
      if (prev.t > 0 && dt > 40 && dt < maxDt && dist < maxDist) {
        clearArmed()
        suppressChromeToggleRef.current = true
        if (e.cancelable) e.preventDefault()
        void resetToFitScale()
        return
      }

      downX = t.clientX
      downY = t.clientY
      moved = false
      armTap = true
      lastContentTapRef.current = { t: now, x: t.clientX, y: t.clientY }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!armTap || e.touches.length !== 1) return
      const t = e.touches[0]
      const limit = canPanRef.current ? 28 : 16
      if (Math.hypot(t.clientX - downX, t.clientY - downY) > limit) {
        moved = true
        // 已构成拖动：作废双击候选，但不清零太早以外的逻辑——直接清
        lastContentTapRef.current = { t: 0, x: 0, y: 0 }
        armTap = false
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!armTap) return
      armTap = false
      if (moved) {
        lastContentTapRef.current = { t: 0, x: 0, y: 0 }
        return
      }
      // 长按不算
      const held = Date.now() - lastContentTapRef.current.t
      if (held > 480) {
        lastContentTapRef.current = { t: 0, x: 0, y: 0 }
      }
      if (suppressChromeToggleRef.current && e.cancelable) e.preventDefault()
    }

    const onTouchCancel = () => {
      // 放大拖动接管滚动：仅作废本次，保留「轻点候选」若几乎没动
      if (!armTap) return
      armTap = false
      if (moved || canPanRef.current) {
        // canPan 下 cancel 很常见；若没移动，保留 lastContentTap 供第二次 touchstart 配对
        if (moved) lastContentTapRef.current = { t: 0, x: 0, y: 0 }
      }
    }

    const onDblClick = (e: MouseEvent) => {
      if (ignoreTarget(e.target)) return
      e.preventDefault()
      suppressChromeToggleRef.current = true
      void resetToFitScale()
    }

    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: false })
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
    el.addEventListener('touchend', onTouchEnd, { capture: true, passive: false })
    el.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true })
    el.addEventListener('dblclick', onDblClick, true)
    return () => {
      el.removeEventListener('touchstart', onTouchStart, true)
      el.removeEventListener('touchmove', onTouchMove, true)
      el.removeEventListener('touchend', onTouchEnd, true)
      el.removeEventListener('touchcancel', onTouchCancel, true)
      el.removeEventListener('dblclick', onDblClick, true)
    }
  }, [isCompact, book.id, loading])

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
    suppressProgressSaveRef.current = false
    if (scrubOriginPendingRef.current) {
      if (nextPage !== currentPageRef.current) pushNavBackPoint()
      scrubOriginPendingRef.current = false
    }
    setPage(nextPage)
  }

  async function addToBasket(targetProjectId?: string) {
    if (!selection) return
    const locator = pdfPersistableLocator(selection.locator, page)
    const ok = await addToBasketCore({ text: selection.text, locator }, targetProjectId)
    if (ok) dismissSelection()
  }

  async function addToNewBasket(name: string) {
    if (!selection) return
    const locator = pdfPersistableLocator(selection.locator, page)
    const ok = await addToNewBasketCore({ text: selection.text, locator }, name)
    if (ok) dismissSelection()
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
    suppressProgressSaveRef.current = false
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
  const chromeShown = chromeVisible || (isCompact && canPan)

  return (
    <motion.div
      className={`reader-shell${chromeShown ? '' : ' chrome-hidden'}`}
      ref={shellRef}
      initial={reduceMotion ? false : { opacity: 0, filter: 'none' }}
      animate={{ opacity: 1, filter: 'none' }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      onPointerMove={(e) => {
        if (!isFullscreen || e.pointerType !== 'mouse') return
        const y = e.clientY
        const h = window.innerHeight
        const threshold = 120
        const shouldShow = y < threshold || y > h - threshold
        if (shouldShow && !chromeVisible) {
          setChromeVisible(true)
        } else if (!shouldShow && chromeVisible && !drawerTab) {
          setChromeVisible(false)
        }
      }}
    >
      <ReaderReturnOriginBar visible={canNavBack} onReturn={goNavBack} onDismiss={clearNavOrigin} />
      <motion.div
        className="reader-topbar"
        initial={false}
        animate={chromeShown ? { y: 0, opacity: 1 } : { y: '-105%', opacity: 0 }}
        transition={reduceMotion ? { duration: 0 } : chromeSpring}
        style={{ pointerEvents: chromeShown ? 'auto' : 'none' }}
      >
        <div className="reader-topbar-left">
          <button className="icon-btn" onClick={() => exitReader(navigate)} title="返回" aria-label="返回">
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
          {!isCompact && (
            <>
              <button
                className="icon-btn reader-zoom-btn"
                onClick={() => changeScale(-0.1)}
                title="缩小"
                aria-label="缩小"
              >
                <Minus size={16} />
              </button>
              <button
                className="icon-btn reader-zoom-btn"
                onClick={() => changeScale(0.1)}
                title="放大"
                aria-label="放大"
              >
                <Plus size={16} />
              </button>
            </>
          )}
          {isCompact && (
            <button
              type="button"
              className={`icon-btn${midSelectMode ? ' active' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setShowPdfSettings(false)
                toggleAnnotateMode()
              }}
              title={midSelectMode ? '退出划词' : '划词标注'}
              aria-label={midSelectMode ? '退出划词' : '划词标注'}
              aria-pressed={midSelectMode}
            >
              <TextSelect size={18} />
            </button>
          )}
          <button
            className={`icon-btn ${drawerTab === 'notes' ? 'active' : ''}`}
            onClick={() => {
              setShowPdfSettings(false)
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
          {!isCompact && (
            <button
              className={`icon-btn ${drawerTab === 'translate' ? 'active' : ''}`}
              onClick={() => {
                setShowPdfSettings(false)
                if (drawerTab === 'translate') setDrawerTab(null)
                else {
                  setShowJournal(false)
                  setDrawerTab('translate')
                }
              }}
              title="划词翻译"
            >
              <Languages size={18} />
            </button>
          )}
          <button
            className={`icon-btn ${drawerTab === 'journal' || showJournal ? 'active' : ''}`}
            onClick={() => {
              setShowPdfSettings(false)
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
          <button
            className={`icon-btn ${showPdfSettings ? 'active' : ''}`}
            onClick={() => {
              setShowPdfSettings((v) => !v)
            }}
            title="阅读设置"
            aria-label="阅读设置"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </motion.div>

      {showPdfSettings && (
        <div
          className="theme-popover"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="theme-popover-title">划词翻译</div>
          <div className="theme-switch-row">
            <span>松手后自动翻译</span>
            <LabSwitch
              checked={autoTranslate}
              onChange={(v) => {
                void updatePreferences({ reader_auto_translate: v })
              }}
            />
          </div>
        </div>
      )}

      <div className="reader-body">
        <div
          className={`reader-viewport pdf-viewport${canPan ? ' pdf-viewport--pannable' : ''}`}
          ref={containerRef}
          onClick={onViewportClick}
          onDoubleClick={(e) => {
            if (!isCompactRef.current) return
            const t = e.target as HTMLElement
            if (t.closest('.pdf-click-zone, .selection-apple, .highlight-popover, button, a, input')) {
              return
            }
            e.preventDefault()
            e.stopPropagation()
            suppressChromeToggleRef.current = true
            void resetToFitScale()
          }}
        >
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
          {/* 放大可拖时卸掉中部翻页层与左右热区，否则会挡住视口滚动 */}
          {isCompact && !midSelectMode && !selection && !loading && !canPan && (
            <ReaderMidSwipeLayer
              onPrev={goPrev}
              onNext={goNext}
              onTap={() => {
                if (suppressChromeToggleRef.current) {
                  suppressChromeToggleRef.current = false
                  return
                }
                // 双击候选窗口内延迟切栏，避免「双击复位」先被第一次轻点误切顶/底栏
                const armed = lastContentTapRef.current
                if (armed.t > 0 && Date.now() - armed.t < 420) {
                  const stamp = armed.t
                  window.setTimeout(() => {
                    if (suppressChromeToggleRef.current) {
                      suppressChromeToggleRef.current = false
                      return
                    }
                    if (lastContentTapRef.current.t !== stamp) return
                    setChromeVisible((v) => !v)
                  }, 300)
                  return
                }
                setChromeVisible((v) => !v)
              }}
              onLongPressSelect={() => enterAnnotateMode({ pinned: false })}
            />
          )}

          {/* 放大可拖时仍保留左右窄热区翻页；中部层已卸，不挡拖动画布 */}
          {!(isCompact && selection) && (
            <>
              <div
                className={`pdf-click-zone left${isCompact ? ' pdf-click-zone-compact' : ''}${canPan && isCompact ? ' pdf-click-zone-pannable' : ''}`}
                aria-hidden
                onPointerDown={suppressZonePointer}
                onMouseDown={suppressZonePointer}
                onClick={(e) => {
                  e.stopPropagation()
                  midSelectPinnedRef.current = false
                  setMidSelectMode(false)
                  handleZoneClick('prev')
                }}
              />
              <div
                className={`pdf-click-zone right${isCompact ? ' pdf-click-zone-compact' : ''}${canPan && isCompact ? ' pdf-click-zone-pannable' : ''}`}
                aria-hidden
                onPointerDown={suppressZonePointer}
                onMouseDown={suppressZonePointer}
                onClick={(e) => {
                  e.stopPropagation()
                  midSelectPinnedRef.current = false
                  setMidSelectMode(false)
                  handleZoneClick('next')
                }}
              />
            </>
          )}

          {selection && (!isCompact || selectionChromeEl) && (
            <SelectionBubble
              variant={isCompact ? 'sheet' : 'bar'}
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
              translate={translateBubble}
              onTranslate={translateNow}
              translatePanelOpen={drawerTab === 'translate'}
              onToggleTranslatePanel={() => {
                if (drawerTab === 'translate') {
                  setDrawerTab(null)
                  return
                }
                openPanelFromBubble()
                setShowPdfSettings(false)
                setShowJournal(false)
                setDrawerTab('translate')
                setChromeVisible(true)
              }}
              portalRoot={isCompact ? selectionChromeEl : shellRef.current}
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

        {drawerTab === 'translate' && (
          <div className="reader-drawer">
            <div className="reader-drawer-header">
              <div style={{ fontWeight: 700 }}>划词翻译</div>
              <button className="icon-btn" onClick={() => setDrawerTab(null)}>
                <X size={16} />
              </button>
            </div>
            <ReaderTranslatePanel entry={translatePanel} onExplain={askExplain} />
          </div>
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

      <motion.div
        className={`reader-bottombar${isCompact && selection ? ' is-selecting' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        initial={false}
        animate={chromeShown ? { y: 0, opacity: 1 } : { y: '105%', opacity: 0 }}
        transition={reduceMotion ? { duration: 0 } : chromeSpring}
        style={{ pointerEvents: chromeShown ? 'auto' : 'none' }}
      >
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
        <div ref={setSelectionChromeEl} className="reader-bottombar-selection" />
      </motion.div>
    </motion.div>
  )
}
