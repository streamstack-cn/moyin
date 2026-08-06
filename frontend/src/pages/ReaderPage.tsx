import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import ePub from 'epubjs'
import type Book from 'epubjs/types/book'
import type Rendition from 'epubjs/types/rendition'
import type { NavItem } from 'epubjs/types/navigation'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Languages,
  List,
  Maximize,
  Minimize,
  Minus,
  NotebookPen,
  PanelsTopLeft,
  Plus,
  RectangleHorizontal,
  Search,
  TextSelect,
  Type,
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
import { isReaderPinchBlocking, markTouchGestureMulti } from '../lib/readerGestureGate'
import { useUISettings } from '../contexts/UISettingsContext'
import {
  injectEpubReaderFonts,
  loadEpubReaderFontFaceCss,
  prefetchEpubReaderFonts,
  READER_FONT_OPTIONS,
  readerFontFamilyCss,
} from '../lib/readerFonts'
import { copyTextToClipboard } from '../lib/clipboard'
import { isAppleTouchDevice } from '../lib/platform'
import { useReaderAnnotateMode } from '../hooks/useReaderAnnotateMode'
import {
  epubCitationSuccessToast,
  useReaderCitationBasket,
} from '../hooks/useReaderCitationBasket'
import {
  EPUB_LOC_CHARS,
  findChapterTitle,
  flattenToc,
  joinEpubHref,
  loadCachedEpubLocations,
  saveCachedEpubLocations,
} from '../lib/epubNav'
import { type SelectionAnchor } from '../lib/readerConstants'
import { epubPersistableLocator } from '../lib/readerSelection'
import {
  clearDomSelection,
  isAccidentalTapSelection,
  pointerTravel,
  selectionText,
} from '../lib/readerGestures'
import { READER_THEMES, resolveReaderTheme } from '../lib/readerTheme'
import {
  resolveHorizontalSwipe,
  resolveHorizontalSwipeByTravel,
  SWIPE_AXIS_RATIO_COMPACT,
  SWIPE_INTENT_PX,
  SWIPE_THRESHOLD_COMPACT_PX,
} from '../lib/readerPageTurnGestures'
import {
  pointerToViewport,
  rangeToScreenBounds,
  rangeToSelectionAnchor,
  withPointer,
} from '../lib/selectionBubblePlacement'
import { findKeywordRanges } from '../lib/findKeywordRanges'
import { HighlightedText, highlightTerms } from '../lib/highlightQuery'
import { isReaderPeekMode } from '../lib/readerDeepLink'
import { exitReader } from '../lib/exitReader'
import { useJournalDrawerWidth } from '../lib/useJournalDrawerWidth'
import { useReaderChromeInset } from '../lib/useReaderChromeInset'
import { useReaderExitBackGesture } from '../hooks/useReaderExitBackGesture'
import PdfReaderPage from './PdfReaderPage'

type DrawerTab = 'toc' | 'notes' | 'search' | 'journal' | 'translate' | null

interface SelectionState {
  cfiRange: string
  text: string
  anchor: SelectionAnchor | null
}

interface ActiveHighlightState {
  id: string
  x: number
  y: number
}

interface SearchHit {
  chapter_title: string
  cfi_anchor: string
  snippet: string
}

export default function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const [bootBook, setBootBook] = useState<BookDetail | null>(null)
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    api
      .get<BookDetail>(`/api/books/${bookId}`)
      .then((b) => {
        if (!cancelled) setBootBook(b)
      })
      .catch((err) => {
        if (!cancelled) setBootError(err instanceof ApiError ? err.message : '加载书籍失败')
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  if (bootError) {
    return (
      <div className="empty-state" style={{ minHeight: '100vh' }}>
        {bootError}
      </div>
    )
  }
  if (!bootBook) {
    return (
      <div className="empty-state" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }
  if (bootBook.file_format === 'pdf') {
    return <PdfReaderPage book={bootBook} />
  }
  return <EpubReaderPage bookId={bookId!} />
}

function EpubReaderPage({ bookId }: { bookId: string }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const currentHrefRef = useRef<string>('')
  // 与 currentHrefRef 同步的 state 版本：仅用于让目录抽屉里的「当前章节」高亮跟着翻页实时刷新，
  // ref 本身不会触发重渲染，所以两个都要维护。
  const [currentHref, setCurrentHref] = useState<string>('')
  const currentCfiRef = useRef<string>('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** true=抑制进度写入（引用/搜索等 peek 深链）；翻页或指定页码后改为 false */
  const suppressProgressSaveRef = useRef(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [book, setBook] = useState<BookDetail | null>(null)
  const [toc, setToc] = useState<NavItem[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlightState | null>(null)
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeVisibleRef = useRef(true)
  /** 关抽屉后短暂锁定，避免点击穿透把顶底栏又藏掉 */
  const chromeToggleLockUntilRef = useRef(0)
  const toggleChromeRef = useRef(() => {})
  const isCompactRef = useRef(
    typeof window !== 'undefined' &&
      (window.matchMedia('(max-width: 860px)').matches ||
        window.matchMedia('(pointer: coarse)').matches),
  )

  toggleChromeRef.current = () => {
    if (Date.now() < chromeToggleLockUntilRef.current) return
    setChromeVisible((v) => !v)
  }
  const selectionRef = useRef<SelectionState | null>(null)
  const bubbleInteractingRef = useRef(false)
  const selectingRef = useRef(false)
  const selectStartedAtRef = useRef(0)
  const lastSelectionActivityAtRef = useRef(0)
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const pointerMovePxRef = useRef(0)
  const viewerWrapRef = useRef<HTMLDivElement | null>(null)
  const [percent, setPercent] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [pagesReady, setPagesReady] = useState(false)
  const [pagesBuilding, setPagesBuilding] = useState(false)
  /** print=EPUB内嵌纸书页；estimate=按豆瓣页数×进度估算；virtual=字符虚拟页（不宜直接作脚注） */
  const [pageSource, setPageSource] = useState<'print' | 'estimate' | 'virtual'>('virtual')
  const [pageInput, setPageInput] = useState('1')
  const currentPageRef = useRef(1)
  const pageSourceRef = useRef<'print' | 'estimate' | 'virtual'>('virtual')
  const metaPageCountRef = useRef(0)
  const [wheelPageTurn, setWheelPageTurn] = useState(true)
  const wheelEnabledRef = useRef(true)
  const lastWheelAtRef = useRef(0)
  const { user, updatePreferences } = useAuth()
  const { readerFont, setReaderFont } = useUISettings()
  /** 移动端从任意 EPUB contents 尝试弹出 Sheet（供轮询兜底） */
  const mobilePresentRef = useRef<() => boolean>(() => false)
  /** 同步 DOM 选区全文到底栏 / 无选区则关闭 */
  const mobileSyncSelectionRef = useRef<() => void>(() => {})
  const lastTouchNavAtRef = useRef(0)
  const lastPresentAtRef = useRef(0)
  const readerFontRef = useRef(readerFont)
  readerFontRef.current = readerFont
  const autoTranslate = user?.preferences?.reader_auto_translate !== false
  const {
    bubble: translateBubble,
    panel: translatePanel,
    translateNow,
    openPanelFromBubble,
    askExplain,
  } = useReaderSelectionTranslate(selection?.text, autoTranslate)
  const [fontSize, setFontSize] = useState(() => {
    const fromUser = Number(user?.preferences?.reader_font_size)
    if (fromUser >= 70 && fromUser <= 180) return fromUser
    const fromLocal = Number(localStorage.getItem('moyin_reader_font_size'))
    if (fromLocal >= 70 && fromLocal <= 180) return fromLocal
    return 100
  })
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia('(max-width: 860px)').matches ||
      window.matchMedia('(pointer: coarse)').matches
    )
  })
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
    bookId,
    resolvePageNo: () => basketPageRef.current,
    successToast: (pageNo) => epubCitationSuccessToast(pageNo, pageSourceRef.current),
  })
  useEffect(() => {
    basketPageRef.current = basketPage
  }, [basketPage])
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
  const [canNavBack, setCanNavBack] = useState(false)
  const navStackRef = useRef<string[]>([])
  const turnPrevRef = useRef<() => void>(() => {})
  const turnNextRef = useRef<() => void>(() => {})
  const fontSizeRef = useRef(fontSize)
  /** 双指缩放时已应用到 epub 的字号，用于步进重排 + 残余 CSS 补间 */
  const pinchAppliedRef = useRef(fontSize)
  const [pinchHud, setPinchHud] = useState<number | null>(null)

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const [selectionChromeEl, setSelectionChromeEl] = useState<HTMLDivElement | null>(null)

  /**
   * 兜底：iOS/Android 长按选词后常丢 pointerup。
   * 须等选区安静一段时间再补弹，避免拖手柄时气泡抢戏。
   */
  useEffect(() => {
    if (!isCompact) return
    if (!midSelectMode && !selection) return
    const quietMs = isAppleTouchDevice() ? 900 : 700
    const tick = () => {
      if (Date.now() - lastTouchNavAtRef.current < 400) return
      if (selectionRef.current) {
        // 已有底栏：持续同步全文，并在 DOM 选区消失后关闭
        mobileSyncSelectionRef.current()
        return
      }
      if (Date.now() - lastSelectionActivityAtRef.current < quietMs) return
      mobilePresentRef.current()
    }
    const id = window.setInterval(tick, 280)
    return () => window.clearInterval(id)
  }, [isCompact, midSelectMode, selection])

  useEffect(() => {
    chromeVisibleRef.current = chromeVisible
  }, [chromeVisible])

  useEffect(() => {
    fontSizeRef.current = fontSize
  }, [fontSize])

  // 尽早把自定义字体打成 data-URI，避免 EPUB iframe 跨域拦截
  useEffect(() => {
    prefetchEpubReaderFonts()
  }, [])

  useReaderChromeInset(shellRef)
  useReaderExitBackGesture(shellRef, navigate, isCompact)
  const { width: journalWidth, onResizePointerDown: onJournalResizePointerDown } = useJournalDrawerWidth()

  useEffect(() => {
    const mqWidth = window.matchMedia('(max-width: 860px)')
    const mqTouch = window.matchMedia('(pointer: coarse)')
    const sync = () => {
      const compact = mqWidth.matches || mqTouch.matches
      isCompactRef.current = compact
      setIsCompact(compact)
      // 移动端固定 A4 版式，不提供全宽切换
      if (mqWidth.matches) setLayoutMode('a4')
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
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    pageSourceRef.current = pageSource
  }, [pageSource])

  useEffect(() => {
    wheelEnabledRef.current = wheelPageTurn
  }, [wheelPageTurn])

  useEffect(() => {
    api
      .get<{ wheel_page_turn: boolean }>('/api/settings/reader')
      .then((r) => setWheelPageTurn(!!r.wheel_page_turn))
      .catch(() => {})
  }, [])
  const [searchQuery, setSearchQuery] = useState('')
  /** 与当前结果列表对应的关键词（避免改输入未重搜时高亮错位） */
  const [searchHighlightQuery, setSearchHighlightQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const searchHighlightCfisRef = useRef<string[]>([])
  const searchFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlashKeyRef = useRef('')
  /** 进度条一次拖动只压栈一次 */
  const scrubOriginPendingRef = useRef(false)
  const flashSearchKeywordRef = useRef<
    (keyword: string, opts?: { refineToKeyword?: boolean; durationMs?: number }) => Promise<number>
  >(async () => 0)
  const [loading, setLoading] = useState(true)

  const [noteContent, setNoteContent] = useState('')
  const [noteSaveState, setNoteSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [journalMode, setJournalMode] = useState<'edit' | 'preview'>('edit')
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [layoutMode, setLayoutMode] = useState<'full' | 'a4'>(
    () => (localStorage.getItem('moyin_reader_layout') as 'full' | 'a4') || 'full',
  )

  // 字号或阅读区尺寸变化时重排；顶栏显隐保持占位，避免内容跳顶
  useEffect(() => {
    const r = renditionRef.current
    const el = viewerRef.current
    if (!r || !el) return
    let timer = 0
    const resize = () => {
      try {
        r.themes.fontSize(`${fontSizeRef.current}%`)
        r.resize(el.clientWidth, el.clientHeight)
      } catch {
        /* ignore */
      }
    }
    timer = window.setTimeout(resize, 80)
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(resize, 50)
    })
    ro.observe(el)
    return () => {
      window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [fontSize, layoutMode])

  /**
   * 全宽↔A4 / 进入退出浏览器全屏后，epub.js 分栏偶发保留旧偏移（正文左切）。
   * 仅靠 ResizeObserver 的 resize 不够，需等 CSS 落稳后 resize + 回到当前 CFI。
   */
  useEffect(() => {
    const r = renditionRef.current
    const el = viewerRef.current
    if (!r || !el || loading) return
    let cancelled = false
    const timers: number[] = []

    const reflow = () => {
      if (cancelled) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (w < 40 || h < 40) return
      try {
        r.themes.fontSize(`${fontSizeRef.current}%`)
        r.resize(w, h)
      } catch {
        return
      }
      const cfi = currentCfiRef.current
      if (!cfi) return
      try {
        void r.display(cfi)
      } catch {
        /* ignore */
      }
    }

    const schedule = (ms: number) => {
      timers.push(
        window.setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(reflow)
          })
        }, ms),
      )
    }
    // 全屏退出有过渡；A4 max-width 也要等一帧布局
    schedule(0)
    schedule(80)
    schedule(200)
    schedule(400)

    return () => {
      cancelled = true
      for (const t of timers) window.clearTimeout(t)
    }
  }, [layoutMode, isFullscreen, loading])

  // 优先使用账号级偏好（跨设备同步），登录前/未设置过时回退到本机 localStorage 缓存
  const [readerThemeId, setReaderThemeId] = useState(
    () => user?.preferences?.reader_theme || localStorage.getItem('moyin_reader_theme') || 'paper',
  )
  const [customBg, setCustomBg] = useState(
    () => user?.preferences?.reader_bg_custom || localStorage.getItem('moyin_reader_bg_custom') || '#f4ecd8',
  )
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const applyHighlightAnnotation = useCallback((h: Highlight) => {
    const rendition = renditionRef.current
    if (!rendition) return
    rendition.annotations.highlight(
      h.cfi_range,
      {},
      (event: MouseEvent) => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        const wrap = viewerWrapRef.current?.getBoundingClientRect()
        setActiveHighlight({
          id: h.id,
          x: (event?.clientX || 0) - (wrap?.left || 0),
          y: (event?.clientY || 0) - (wrap?.top || 0),
        })
        setSelection(null)
      },
      'moyin-hl',
      { fill: h.color, 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' },
    )
  }, [])

  useEffect(() => {
    if (!bookId) return
    // 注意：React 18/19 StrictMode 在开发模式下会对每个 effect 先 mount→cleanup→再 mount 一次，
    // 用来暴露"未正确清理"的副作用。epub.js 的 Book/Rendition 是有状态的命令式对象，若像常见写法
    // 那样把它们存进共享 ref、cleanup 时又读同一个 ref，就会在两次 mount 间发生竞态（第一次的异步
    // 初始化还没完成，第二次已经创建了新实例并覆盖了 ref，导致 viewerRef 上出现两个互相干扰的实例，
    // 表现为一直停在 loading）。这里改为让每次 effect 调用持有"自己的"本地实例引用，cleanup 只销毁
    // 自己创建的那一份，并在每个 await 之后都检查 cancelled，从根本上避免竞态。
    let cancelled = false
    let localEpub: Book | null = null
    let localRendition: Rendition | null = null
    let keyupHandler: ((e: KeyboardEvent) => void) | null = null
    let touchStartHandler: ((e: TouchEvent) => void) | null = null
    let touchEndHandler: ((e: TouchEvent) => void) | null = null
    let clickHandler: ((event: MouseEvent, contents: { window: Window }) => void) | null = null
    let viewportClickHandler: ((event: MouseEvent) => void) | null = null
    let wheelHandler: ((e: WheelEvent) => void) | null = null
    let viewportEl: HTMLElement | null = null

    async function init() {
      setLoading(true)
      try {
        // 关键路径：详情 + 进度先到即可开书；高亮/引用篮/笔记并行侧载，不阻塞首屏
        const [detail, progress] = await Promise.all([
          api.get<BookDetail>(`/api/books/${bookId}`),
          api.get<{ location: string; percent: number }>(`/api/books/${bookId}/progress`),
        ])
        if (cancelled) return
        setBook(detail)
        metaPageCountRef.current = Number(detail.page_count) || 0
        // 后端存的是 0~1 小数；历史数据偶发存成 0~100，这里兼容两种
        const rawPct = Number(progress.percent) || 0
        setPercent(Math.round(rawPct <= 1 ? rawPct * 100 : rawPct))

        const sideLoad = Promise.all([
          api.get<Highlight[]>(`/api/highlights/book/${bookId}`).catch(() => [] as Highlight[]),
          loadProjects(),
          api.get<BookNote>(`/api/notes/${bookId}`).catch(() => ({ content: '' }) as BookNote),
        ]).then(([hs, _projs, note]) => {
          if (cancelled) return [] as Highlight[]
          setHighlights(hs)
          setNoteContent(note.content || '')
          return hs
        })

        const token = getToken()
        const epub = ePub(`/api/books/${bookId}/read`, {
          // 我们的下载接口路径没有 .epub 后缀，epub.js 靠扩展名判断打开方式，
          // 不显式指定 openAs 会被误判为"目录"从而尝试拼接子路径请求，导致一直卡住。
          openAs: 'epub',
          requestHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (cancelled) {
          epub.destroy()
          return
        }
        localEpub = epub
        bookRef.current = epub

        const rendition = epub.renderTo(viewerRef.current as HTMLDivElement, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          // 注意：不要用 spread: 'auto'（双页对开）。实测双页模式下，
          // 直接 display() 到一个较深的历史 CFI 会导致 epub.js 的分栏定位算法
          // 卡死在无限循环里（表现为阅读进度永远停在 0%、内容不渲染）。
          // 单栏模式没有这个问题，且更适合本项目的"点击翻页 + A4 居中"布局。
          spread: 'none',
        })
        if (cancelled) {
          rendition.destroy()
          epub.destroy()
          return
        }
        localRendition = rendition
        renditionRef.current = rendition
        const themeColors = resolveReaderTheme(readerThemeId, customBg)
        const bodyFont = readerFontFamilyCss(readerFontRef.current)
        const iframeTouchAction = isAppleTouchDevice() ? 'manipulation' : 'pan-y pinch-zoom'
        rendition.themes.default({
          '::selection': { background: 'rgba(216,169,78,0.35)' },
          html: {
            /* iOS：manipulation 避免 pan-y 抢走选区手柄；Android 保留纵向翻页手势空间 */
            'touch-action': iframeTouchAction,
          },
          body: {
            'font-family': `${bodyFont} !important`,
            background: `${themeColors.bg} !important`,
            color: `${themeColors.fg} !important`,
            /* iOS 需显式允许选字，否则划词无选区、气泡出不来 */
            '-webkit-user-select': 'text !important',
            'user-select': 'text !important',
            /* 减弱 iOS 系统划词菜单，改走自研底栏操作条 */
            '-webkit-touch-callout': 'none !important',
            'touch-action': iframeTouchAction,
          },
          'p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, a': {
            'font-family': `${bodyFont} !important`,
            '-webkit-user-select': 'text !important',
            'user-select': 'text !important',
            '-webkit-touch-callout': 'none !important',
            color: `${themeColors.fg} !important`,
          },
        })
        // 恢复账号/本机记住的字号
        rendition.themes.fontSize(`${fontSizeRef.current}%`)
        if (viewerRef.current) viewerRef.current.style.background = themeColors.bg
        navStackRef.current = []
        currentCfiRef.current = ''
        currentHrefRef.current = ''
        setCanNavBack(false)

        // 从搜索结果点进来时，直接定位到对应高亮所在位置（该处本身已有高亮底色标记）
        // 失效 CFI 会导致 display 挂起，加超时；失败时必须用百分比续读，绝不能默默回到开头并写回 0%
        // restart=1：重新阅读，忽略已存进度并从开头开始
        // EPUB 忽略误传的 pdf: 定位（常见于只有纸书页码的旧引用）
        const rawJump = (searchParams.get('cfi') || '').trim()
        const jumpCfi = rawJump.startsWith('pdf:') ? '' : rawJump
        const restart = searchParams.get('restart') === '1'
        const peekMode = isReaderPeekMode(searchParams)
        // 引用 / 搜索等定位进入：先不写进度，等用户主动翻页或改页后再记
        // 恢复进度期间也必须抑制写入，否则失败回退首页会把 26% 覆盖成 0%
        const restoringRef = { current: true }
        suppressProgressSaveRef.current = peekMode || !restart
        const savedLoc = restart ? '' : String(progress.location || '').trim()
        const savedPctRaw = Number(progress.percent) || 0
        const savedPct = savedPctRaw > 1.5 ? savedPctRaw / 100 : savedPctRaw
        const displayWithTimeout = (loc?: string) =>
          Promise.race([
            rendition.display(loc),
            new Promise((_, reject) => setTimeout(() => reject(new Error('display timeout')), 8000)),
          ])

        const tryDisplay = async (loc?: string) => {
          if (!loc) {
            await displayWithTimeout(undefined)
            return true
          }
          try {
            await displayWithTimeout(loc)
            return true
          } catch {
            return false
          }
        }

        epub.loaded.navigation.then((nav) => {
          if (!cancelled) setToc(nav.toc)
        })

        // 高亮等侧数据返回后再挂注解（不挡首屏 display）
        void sideLoad.then((hs) => {
          if (cancelled || !hs?.length) return
          hs.forEach(applyHighlightAnnotation)
        })

        const readPercentage = (cfi?: string, fallback = 0) => {
          if (cfi && epub.locations.length() > 0) {
            try {
              const pct = epub.locations.percentageFromCfi(cfi)
              if (typeof pct === 'number' && !Number.isNaN(pct)) return pct
            } catch {
              /* ignore */
            }
          }
          return fallback
        }

        const syncPageFromCfi = (cfi?: string, fallbackPct = 0) => {
          if (!cfi) return
          const pct = readPercentage(cfi, fallbackPct)
          setPercent(Math.round(pct * 100))

          // 1) EPUB 内嵌 page-list → 真实纸书页（脚注最准）
          try {
            const pageList = epub.pageList as unknown as {
              pages?: number[]
              lastPage?: number
              pageFromCfi: (c: string) => number
            }
            if (pageList?.pages && pageList.pages.length > 0) {
              const pg = pageList.pageFromCfi(cfi)
              if (typeof pg === 'number' && pg > 0) {
                const total = pageList.lastPage || pageList.pages[pageList.pages.length - 1] || pg
                setPageSource('print')
                setCurrentPage(pg)
                setPageInput(String(pg))
                setTotalPages(total)
                setPagesReady(true)
                return
              }
            }
          } catch {
            /* ignore */
          }

          // 2) 元数据页数 × 阅读进度 → 估算纸书页（适合已匹配豆瓣页数的书）
          const metaPages = metaPageCountRef.current
          if (metaPages > 0) {
            const pg = Math.max(1, Math.min(metaPages, Math.round(pct * metaPages) || 1))
            setPageSource('estimate')
            setCurrentPage(pg)
            setPageInput(String(pg))
            setTotalPages(metaPages)
            setPagesReady(true)
            return
          }

          // 3) 字符虚拟页 — 仅导航用，不宜直接写入学术脚注
          if (epub.locations.length() > 0) {
            try {
              const loc = epub.locations.locationFromCfi(cfi)
              if (typeof loc === 'number' && loc >= 0) {
                setPageSource('virtual')
                setCurrentPage(loc + 1)
                setPageInput(String(loc + 1))
                setTotalPages(epub.locations.length())
                setPagesReady(true)
              }
            } catch {
              /* ignore */
            }
          }
        }

        // 生成/加载 locations（进度百分比依赖它）；页码优先用 page-list / 元数据估算。
        const ensureLocations = async () => {
          try {
            await epub.ready
            if (cancelled) return
            try {
              await epub.loaded.pageList
            } catch {
              /* 多数 EPUB 无 page-list */
            }
            if (epub.locations.length() > 0) return
            const cached = loadCachedEpubLocations(bookId)
            if (cached) {
              epub.locations.load(cached)
              return
            }
            setPagesBuilding(true)
            ;(epub.locations as unknown as { pause: number }).pause = 1
            await epub.locations.generate(EPUB_LOC_CHARS)
            if (cancelled) return
            if (epub.locations.length() > 0) {
              saveCachedEpubLocations(bookId, epub.locations.save())
            }
          } catch (err) {
            console.warn('EPUB 页码索引生成失败', err)
          } finally {
            if (!cancelled) setPagesBuilding(false)
          }
        }

        rendition.on(
          'relocated',
          (location: {
            start: { href: string; percentage: number; cfi: string; displayed?: { page: number; total: number } }
          }) => {
            currentHrefRef.current = location.start.href
            setCurrentHref(location.start.href)
            if (location.start.cfi) currentCfiRef.current = location.start.cfi
            if (epub.locations.length() > 0 || metaPageCountRef.current > 0 || (epub.pageList as unknown as { pages?: number[] })?.pages?.length) {
              syncPageFromCfi(location.start.cfi, location.start.percentage)
            } else {
              const displayed = location.start.displayed
              if (displayed?.page) {
                setCurrentPage(displayed.page)
                setPageInput(String(displayed.page))
              }
              setPercent(Math.round((location.start.percentage || 0) * 100))
            }
            // 恢复定位中禁止写回，避免 CFI 失败落到首页后把原进度覆盖成 0%
            if (restoringRef.current || suppressProgressSaveRef.current) return
            const pctForSave = readPercentage(location.start.cfi, location.start.percentage)
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveTimerRef.current = setTimeout(() => {
              if (restoringRef.current || suppressProgressSaveRef.current) return
              api
                .put(`/api/books/${bookId}/progress`, {
                  location: location.start.cfi,
                  percent: pctForSave,
                })
                .catch(() => {})
            }, 800)
          },
        )

        // 续读优先级：深链 CFI → 已存 CFI → 已存百分比（仅用缓存）→ 开头
        // 注意：无 locations 缓存时绝不在首屏 await generate（安卓上极慢），先出书再后台定位
        let restored = false
        let pendingPctRelocate = false
        let openedFallbackStart = false
        try {
          if (jumpCfi) {
            restored = await tryDisplay(jumpCfi)
          } else if (!restart) {
            const cfiLike = savedLoc.includes('epubcfi') || savedLoc.startsWith('epubcfi')
            if (cfiLike) {
              restored = await tryDisplay(savedLoc)
            }
            if (!restored && savedPct >= 0.005) {
              const cached = loadCachedEpubLocations(bookId)
              if (cached) {
                try {
                  epub.locations.load(cached)
                  const fromPct = epub.locations.cfiFromPercentage(Math.min(0.999, Math.max(0, savedPct)))
                  if (fromPct) restored = await tryDisplay(fromPct)
                } catch {
                  /* ignore */
                }
              } else {
                pendingPctRelocate = true
              }
            }
          }
          if (!cancelled && !restored) {
            await tryDisplay(undefined)
            openedFallbackStart = true
          }
        } finally {
          // 首屏已渲染：立刻结束 loading，后续索引/手势注册不挡阅读
          if (!cancelled) setLoading(false)
          if (!cancelled) {
            restoringRef.current = false
            if (peekMode) {
              suppressProgressSaveRef.current = true
            } else if (pendingPctRelocate) {
              // 后台补定位期间暂不写进度，避免先落到开头把原进度冲掉
              suppressProgressSaveRef.current = true
            } else if (
              openedFallbackStart &&
              !restart &&
              (savedPct >= 0.005 || Boolean(savedLoc))
            ) {
              // 续读失败落到开头：保留库里的旧进度，等用户主动翻页后再写
              suppressProgressSaveRef.current = true
              toast.message('未能精确恢复上次位置，已打开开头（原进度仍保留）')
            } else {
              suppressProgressSaveRef.current = false
            }
          }
        }
        if (cancelled) return

        // 页码索引后台补齐；无缓存的百分比续读在此生成后跳转
        void ensureLocations().then(async () => {
          if (cancelled) return
          if (pendingPctRelocate && epub.locations.length() > 0) {
            try {
              const fromPct = epub.locations.cfiFromPercentage(Math.min(0.999, Math.max(0, savedPct)))
              if (fromPct) {
                restoringRef.current = true
                await tryDisplay(fromPct)
                restoringRef.current = false
                if (!peekMode) suppressProgressSaveRef.current = false
              }
            } catch {
              if (!peekMode) suppressProgressSaveRef.current = true
            }
          }
          if (cancelled) return
          const cur = rendition.currentLocation() as unknown as { start?: { cfi: string; percentage?: number } }
          syncPageFromCfi(cur?.start?.cfi, cur?.start?.percentage || savedPct)
        })

        const resolveSelectionAnchor = (
          range: Range,
          contents: { document: Document },
          pointerClient?: { x: number; y: number } | null,
        ): SelectionAnchor | null => {
          try {
            const iframe = contents.document.defaultView?.frameElement as HTMLElement | null
            const iframeRect = iframe?.getBoundingClientRect()
            const wrapRect = viewerWrapRef.current?.getBoundingClientRect()
            const offsetLeft = (iframeRect?.left || 0) - (wrapRect?.left || 0)
            const offsetTop = (iframeRect?.top || 0) - (wrapRect?.top || 0)
            const base = rangeToSelectionAnchor(range, { left: offsetLeft, top: offsetTop })
            const screen = rangeToScreenBounds(range, iframe)
            const pointer = pointerClient
              ? pointerToViewport(pointerClient.x, pointerClient.y, wrapRect || undefined)
              : null
            const withPtr = withPointer(base, pointer)
            if (!withPtr) return screen ? { x: screen.midX, y: screen.top, height: screen.bottom - screen.top, screen } : null
            return { ...withPtr, screen: screen || undefined }
          } catch {
            return null
          }
        }

        type ContentsLike = {
          document: Document
          window: Window
          cfiFromRange: (range: Range) => string
        }

        let lastPresentAt = 0
        type CapturedSel = { text: string; range: Range | null; cfi: string }
        const captureSelection = (contents: ContentsLike): CapturedSel | null => {
          try {
            const sel = contents.window.getSelection()
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
            let range: Range | null = null
            try {
              range = sel.getRangeAt(0).cloneRange()
            } catch {
              range = null
            }
            // iOS 上 sel.toString() 有时只返回首段；与 range 取更长者
            const fromSel = sel.toString().trim()
            const fromRange = range?.toString().trim() || ''
            const text = fromRange.length > fromSel.length ? fromRange : fromSel
            if (!text) return null
            let cfi = ''
            if (range) {
              try {
                cfi = contents.cfiFromRange(range) || ''
              } catch {
                cfi = ''
              }
            }
            return { text, range, cfi }
          } catch {
            return null
          }
        }
        /** 可用快照弹出面板：不依赖 settle 时 DOM 仍有选区（iOS 常已清空） */
        const presentCapturedSelection = (
          contents: ContentsLike,
          captured: CapturedSel,
          force = false,
          pointerClient?: { x: number; y: number } | null,
        ) => {
          if (!force && selectingRef.current) return false
          const text = captured.text.trim()
          if (!text) return false
          const gestureMs = selectStartedAtRef.current
            ? Date.now() - selectStartedAtRef.current
            : undefined
          if (!force && isAccidentalTapSelection(text, pointerMovePxRef.current, gestureMs)) {
            clearDomSelection(contents.window)
            return false
          }
          if (!force && Date.now() - lastPresentAt < 50 && selectionRef.current?.text === text) {
            return true
          }
          let cfiRange = captured.cfi || ''
          let anchor: SelectionAnchor | null = null
          const ptr = pointerClient ?? lastPointerClientRef.current
          if (captured.range) {
            try {
              if (!cfiRange) {
                try {
                  cfiRange = contents.cfiFromRange(captured.range) || ''
                } catch {
                  cfiRange = ''
                }
              }
              anchor = resolveSelectionAnchor(captured.range, contents, ptr)
            } catch {
              anchor = null
            }
          }
          // 底部 sheet 不依赖锚点几何；给占位避免桌面 bar 完全无定位
          if (!anchor) {
            const wrap = viewerWrapRef.current?.getBoundingClientRect()
            const midX = (wrap?.width || 320) / 2
            const midY = (wrap?.height || 480) * 0.4
            anchor = {
              x: midX,
              y: midY,
              height: 20,
              screen: {
                top: midY,
                bottom: midY + 20,
                left: midX - 40,
                right: midX + 40,
                midX,
              },
            }
          }
          setActiveHighlight(null)
          if (pageSourceRef.current !== 'virtual' && currentPageRef.current > 0) {
            setBasketPage(String(currentPageRef.current))
          } else {
            setBasketPage('')
          }
          const nextSel = { cfiRange: cfiRange || `mobile-${Date.now()}`, text, anchor }
          selectionRef.current = nextSel
          lastPresentAt = Date.now()
          lastPresentAtRef.current = lastPresentAt
          if (isCompactRef.current) setChromeVisible(true)
          setSelection(nextSel)
          return true
        }
        const presentSelectionFromContents = (
          contents: ContentsLike,
          cfiHint?: string,
          force = false,
          pointerClient?: { x: number; y: number } | null,
        ) => {
          const captured = captureSelection(contents)
          if (!captured) return false
          if (cfiHint) captured.cfi = cfiHint
          return presentCapturedSelection(contents, captured, force, pointerClient)
        }

        rendition.on(
          'selected',
          (cfiRange: string, contents: ContentsLike) => {
            // 拖选过程中 epub.js 也会触发 selected；等 pointerup 再出
            if (selectingRef.current) return
            // 移动端改走 selectionchange settle，避免选未定就弹横条
            if (isCompactRef.current) return
            presentSelectionFromContents(contents, cfiRange)
          },
        )

        // 触摸导航时间戳（content hook 与后文 click 共用，需提前声明）
        let lastTouchNavAt = 0

        // 右键 / 触摸选区 / 脚注内链 / iframe 内点按 / 左右滑翻页
        // 注意：display() 已在上方完成。hooks.content 对「已加载章节」不会补触发，
        // 必须用具名函数 + getContents() 补绑，否则移动端只有系统选区菜单、没有墨引 Sheet。
        const selectionBoundDocs = new WeakSet<Document>()
        const attachSelectionHandlers = (contents: ContentsLike) => {
          if (!contents?.document || !contents.window) return
          if (selectionBoundDocs.has(contents.document)) return
          // EPUB iframe 独立文档，需单独注入自定义字体
          try {
            injectEpubReaderFonts(contents.document)
          } catch {
            /* ignore */
          }
          const onContextMenu = (event: MouseEvent) => {
            const text = selectionText(contents.window)
            if (!text) return
            event.preventDefault()
            event.stopPropagation()
            selectingRef.current = false
            lastPointerClientRef.current = { x: event.clientX, y: event.clientY }
            presentSelectionFromContents(contents, undefined, true, lastPointerClientRef.current)
          }
          let clearTimer: ReturnType<typeof setTimeout> | null = null
          let showTimer: ReturnType<typeof setTimeout> | null = null
          /** 选区文本稳定一段时间后再弹，避免拖选/拖手柄时挡手 */
          const SELECTION_SETTLE_MS = 520
          const dismissOpenBubble = () => {
            if (!selectionRef.current) return
            selectionRef.current = null
            setSelection(null)
            setBasketPage('')
            selectingRef.current = false
            bubbleInteractingRef.current = false
            lastSelectionActivityAtRef.current = 0
            // 关闭底栏时退出临时划词，恢复中部翻页层（顶栏钉住除外）
            if (!midSelectPinnedRef.current) setMidSelectMode(false)
          }
          const clearSettleTimer = () => {
            if (showTimer) {
              clearTimeout(showTimer)
              showTimer = null
            }
          }
          /** iOS 常在 touchend 之后才写好选区：短重试。移动端不清 DOM，避免与系统菜单/手柄竞态把 Sheet 冲掉 */
          const tryPresentSelection = (retriesLeft: number) => {
            if (Date.now() - lastTouchNavAt < 400) return false
            const captured = captureSelection(contents)
            if (captured) {
              selectingRef.current = false
              return presentCapturedSelection(
                contents,
                captured,
                true,
                lastPointerClientRef.current,
              )
            }
            if (retriesLeft > 0) {
              window.setTimeout(() => tryPresentSelection(retriesLeft - 1), 80)
            }
            return false
          }
          const pickLongestCapture = (): { contents: ContentsLike; captured: CapturedSel } | null => {
            let best: { contents: ContentsLike; captured: CapturedSel } | null = null
            try {
              const raw = rendition.getContents?.() as unknown
              const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as ContentsLike[]
              for (const c of list) {
                const captured = captureSelection(c)
                if (!captured) continue
                if (!best || captured.text.length > best.captured.text.length) {
                  best = { contents: c, captured }
                }
              }
            } catch {
              /* ignore */
            }
            if (!best) {
              const captured = captureSelection(contents)
              if (captured) best = { contents, captured }
            }
            return best
          }
          const presentFromAnyContents = (): boolean => {
            if (Date.now() - lastTouchNavAt < 400) return false
            const best = pickLongestCapture()
            if (!best) return tryPresentSelection(0)
            selectingRef.current = false
            return presentCapturedSelection(
              best.contents,
              best.captured,
              true,
              lastPointerClientRef.current,
            )
          }
          const syncSelectionFromDom = () => {
            const best = pickLongestCapture()
            if (best) {
              lastSelectionActivityAtRef.current = Date.now()
              if (!selectionRef.current || selectionRef.current.text !== best.captured.text) {
                selectingRef.current = false
                presentCapturedSelection(
                  best.contents,
                  best.captured,
                  true,
                  lastPointerClientRef.current,
                )
              }
              return
            }
            // DOM 已无选区：关闭底栏（刚弹出的极短窗口除外，防 iOS 闪断）
            if (!selectionRef.current) return
            if (Date.now() - lastPresentAtRef.current < 280) return
            if (bubbleInteractingRef.current) {
              // 点底栏按钮时短暂 interacting，不因此卡住关闭；超时仍关
              if (Date.now() - lastPresentAtRef.current < 1200) return
            }
            dismissOpenBubble()
          }
          mobilePresentRef.current = presentFromAnyContents
          mobileSyncSelectionRef.current = syncSelectionFromDom
          // 调试探针：真机/自动化验收用；不影响生产 UI
          try {
            ;(window as unknown as { __moyinPresent?: () => boolean }).__moyinPresent =
              presentFromAnyContents
            ;(window as unknown as { __moyinSelDebug?: () => Record<string, unknown> }).__moyinSelDebug =
              () => {
                const captured = captureSelection(contents)
                return {
                  compact: isCompactRef.current,
                  selecting: selectingRef.current,
                  hasReactSel: Boolean(selectionRef.current),
                  domText: selectionText(contents.window),
                  captured: captured?.text?.slice(0, 40) || null,
                  lastTouchNavAge: Date.now() - lastTouchNavAt,
                  midSelect: midSelectPinnedRef.current,
                }
              }
          } catch {
            /* ignore */
          }

          const scheduleSettledPresent = () => {
            clearSettleTimer()
            if (Date.now() - lastTouchNavAt < 400) return
            if (isCompactRef.current) {
              // 选区稳定后再弹：拖选/拖手柄时 selectionchange 会不断重置计时
              // iOS 要更久，否则气泡过早挡住继续扩选
              const settleMs = isAppleTouchDevice() ? 880 : 680
              showTimer = setTimeout(() => {
                showTimer = null
                if (bubbleInteractingRef.current) return
                if (Date.now() - lastTouchNavAt < 400) return
                const quiet = Date.now() - lastSelectionActivityAtRef.current
                // 选区仍在变化：继续等；若 selectingRef 卡住但选区已静，照常弹出
                if (quiet < settleMs - 40) {
                  scheduleSettledPresent()
                  return
                }
                selectingRef.current = false
                if (!presentFromAnyContents()) tryPresentSelection(10)
              }, settleMs)
              return
            }
            const captured = captureSelection(contents)
            if (!captured) return
            showTimer = setTimeout(() => {
              showTimer = null
              if (selectingRef.current) return
              if (bubbleInteractingRef.current) return
              if (Date.now() - lastTouchNavAt < 400) return
              const live = captureSelection(contents)
              presentCapturedSelection(contents, live || captured, true, lastPointerClientRef.current)
            }, SELECTION_SETTLE_MS)
          }
          const onPointerDownTrack = (e: PointerEvent) => {
            selectingRef.current = true
            selectStartedAtRef.current = Date.now()
            pointerStartRef.current = { x: e.clientX, y: e.clientY }
            lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
            pointerMovePxRef.current = 0
            clearSettleTimer()
            if (bubbleInteractingRef.current) return
            // 移动端功能条在底栏，不挡正文：拖动手柄时保留，避免 iOS 选区被拆掉重建
            if (isCompactRef.current) return
            dismissOpenBubble()
          }
          const onPointerMoveTrack = (e: PointerEvent) => {
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
              const sel = contents.window.getSelection()
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
                const sel = contents.window.getSelection()
                if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
                  saved = sel.getRangeAt(0).cloneRange()
                }
              } catch {
                /* ignore */
              }
              presentSelectionFromContents(contents, undefined, false, lastPointerClientRef.current)
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
          const anyContentsHasSelection = () => {
            if (selectionText(contents.window)) return true
            try {
              const raw = rendition.getContents?.() as unknown
              const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as ContentsLike[]
              for (const c of list) {
                if (selectionText(c.window)) return true
              }
            } catch {
              /* ignore */
            }
            return false
          }
          const onSelectionChange = () => {
            const text = selectionText(contents.window)
            if (text) {
              lastSelectionActivityAtRef.current = Date.now()
              if (!selectStartedAtRef.current) selectStartedAtRef.current = Date.now()
              if (clearTimer) {
                clearTimeout(clearTimer)
                clearTimer = null
              }
              if (isCompactRef.current) {
                // 底栏已开：取各 iframe 最长选区立刻同步；未开则 settle 后再出
                if (selectionRef.current) {
                  syncSelectionFromDom()
                } else {
                  scheduleSettledPresent()
                }
                return
              }
              // 桌面：手指仍在拖选时只藏气泡
              if (selectingRef.current) {
                if (!bubbleInteractingRef.current) dismissOpenBubble()
                return
              }
              // 手柄调整导致选区变化：先收起功能条，待稳定后再出（保留选区）
              if (selectionRef.current && selectionRef.current.text !== text) {
                dismissOpenBubble()
              }
              scheduleSettledPresent()
              return
            }
            clearSettleTimer()
            // 取消选中必须关掉气泡。刚弹出时系统可能瞬间清空选区，延迟到 keep 窗口后再确认
            if (!selectionRef.current) return
            if (clearTimer) clearTimeout(clearTimer)
            const keepMs = isAppleTouchDevice() ? 360 : 220
            const age = Date.now() - lastPresentAt
            const delay = Math.max(100, keepMs - age + 30)
            clearTimer = setTimeout(() => {
              clearTimer = null
              if (anyContentsHasSelection()) return
              // interacting 只宽限一次；避免点「更多/关闭」后锁死永不关
              bubbleInteractingRef.current = false
              dismissOpenBubble()
            }, delay)
          }
          const syncOrPresentAfterTouch = () => {
            if (!isCompactRef.current) {
              scheduleSettledPresent()
              return
            }
            // 松手后立刻用当前选区刷新底栏全文；若已取消选中则关闭
            if (presentFromAnyContents()) return
            if (selectionRef.current && !anyContentsHasSelection()) {
              dismissOpenBubble()
              return
            }
            scheduleSettledPresent()
          }
          const onPointerUpSelect = (e: PointerEvent) => {
            if (e.pointerType === 'touch') {
              selectingRef.current = false
              lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
              syncOrPresentAfterTouch()
              return
            }
            // 鼠标必须同步弹出：延迟会被随后的 click 抢先清掉选区
            finishSelect(0, { x: e.clientX, y: e.clientY })
          }
          const onPointerCancelSelect = (e: PointerEvent) => {
            selectingRef.current = false
            lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
            if (isCompactRef.current) {
              syncOrPresentAfterTouch()
              return
            }
            finishSelect(0, { x: e.clientX, y: e.clientY })
          }

          let iframeTouchX = 0
          let iframeTouchY = 0
          let iframeTouchAt = 0
          let touchMaxAbsDx = 0
          let touchMaxAbsDy = 0
          let touchPeakDx = 0
          let iframeTouchMulti = false
          const onIframeTouchStart = (e: TouchEvent) => {
            if (e.touches.length >= 2 || isReaderPinchBlocking()) {
              iframeTouchMulti = true
              markTouchGestureMulti()
              return
            }
            iframeTouchMulti = false
            const t = e.touches?.[0]
            if (!t) return
            iframeTouchX = t.clientX
            iframeTouchY = t.clientY
            iframeTouchAt = Date.now()
            touchMaxAbsDx = 0
            touchMaxAbsDy = 0
            touchPeakDx = 0
            pointerStartRef.current = { x: t.clientX, y: t.clientY }
            pointerMovePxRef.current = 0
          }
          const onTouchEndSelect = (e: TouchEvent) => {
            const t = e.changedTouches?.[0]
            const ptr = t ? { x: t.clientX, y: t.clientY } : null
            if (ptr) lastPointerClientRef.current = ptr
            selectingRef.current = false

            if (iframeTouchMulti || e.touches.length >= 1 || isReaderPinchBlocking()) {
              if (e.touches.length === 0) iframeTouchMulti = false
              return
            }

            const swipeOpts = isCompactRef.current
              ? { threshold: SWIPE_THRESHOLD_COMPACT_PX, axisRatio: SWIPE_AXIS_RATIO_COMPACT }
              : undefined

            // 已有选区或正在调手柄：绝不当成翻页，避免 iOS 拖光标全选错乱
            const hasLiveSel = Boolean(selectionText(contents.window) || selectionRef.current)
            if (hasLiveSel) {
              syncOrPresentAfterTouch()
              return
            }

            // 明确横滑：优先翻页（过程中误触选区不挡）
            if (t) {
              const byEnd = resolveHorizontalSwipe(
                { clientX: iframeTouchX, clientY: iframeTouchY },
                { clientX: t.clientX, clientY: t.clientY },
                swipeOpts,
              )
              const byTravel = resolveHorizontalSwipeByTravel(
                touchPeakDx,
                touchMaxAbsDx,
                touchMaxAbsDy,
                swipeOpts,
              )
              const dir = byEnd.direction || byTravel.direction
              if (dir) {
                clearSettleTimer()
                clearDomSelection(contents.window)
                lastSelectionActivityAtRef.current = 0
                if (selectionRef.current) {
                  selectionRef.current = null
                  setSelection(null)
                  setBasketPage('')
                }
                lastTouchNavAt = Date.now()
                lastTouchNavAtRef.current = lastTouchNavAt
                if (dir === 'next') turnNextRef.current()
                else turnPrevRef.current()
                return
              }
            }

            // 已有选区 / 刚划过词：只出功能面板
            scheduleSettledPresent()
          }

          const onLinkClickCapture = (event: MouseEvent) => {
            const target = event.target as Element | null
            const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
            if (!anchor) return
            const href = anchor.getAttribute('href') || ''
            if (!href || /^(https?:|mailto:|javascript:)/i.test(href)) return
            const cfi =
              currentCfiRef.current ||
              (() => {
                try {
                  return (rendition.currentLocation() as { start?: { cfi?: string } } | null)?.start?.cfi || ''
                } catch {
                  return ''
                }
              })()
            if (!cfi) return
            const stack = navStackRef.current
            if (stack[stack.length - 1] !== cfi) stack.push(cfi)
            setCanNavBack(true)
          }
          const onIframeTouchMove = (e: TouchEvent) => {
            if (e.touches.length >= 2 || isReaderPinchBlocking()) {
              iframeTouchMulti = true
              markTouchGestureMulti()
              return
            }
            if (iframeTouchMulti) return
            const t = e.touches?.[0]
            if (!t) return
            const dx = t.clientX - iframeTouchX
            const dy = t.clientY - iframeTouchY
            touchMaxAbsDx = Math.max(touchMaxAbsDx, Math.abs(dx))
            touchMaxAbsDy = Math.max(touchMaxAbsDy, Math.abs(dy))
            if (Math.abs(dx) >= Math.abs(touchPeakDx)) touchPeakDx = dx
            if (pointerStartRef.current) {
              pointerMovePxRef.current = Math.max(
                pointerMovePxRef.current,
                pointerTravel(pointerStartRef.current, t.clientX, t.clientY),
              )
            }
            // 已有选区 / 气泡已开：用户在拖手柄扩选，绝不清选区、不 preventDefault（iOS 否则易全选下方）
            if (selectionText(contents.window) || selectionRef.current) return
            // 横向意图明确：清误触选区，并阻止滚动抢走手势
            if (
              touchMaxAbsDx >= SWIPE_INTENT_PX &&
              touchMaxAbsDx > touchMaxAbsDy * SWIPE_AXIS_RATIO_COMPACT
            ) {
              clearDomSelection(contents.window)
              lastSelectionActivityAtRef.current = 0
              if (e.cancelable) e.preventDefault()
            }
          }
          const onIframeTouchEndNav = (e: TouchEvent) => {
            // 横滑翻页已在 onTouchEndSelect 处理；此处仅中央点按切换工具栏
            if (Date.now() - lastPresentAt < 500) return
            if (Date.now() - lastTouchNavAt < 400) return
            if (selectionRef.current) return
            if (selectionText(contents.window)) return
            const t = e.changedTouches?.[0]
            if (!t) return
            if (Date.now() - iframeTouchAt > 450) return
            if (Math.abs(t.clientX - iframeTouchX) > 18 || Math.abs(t.clientY - iframeTouchY) > 18) return
            const target = e.target as HTMLElement | null
            if (target?.closest?.('a, button, input, textarea, select')) return
            const w = contents.window.innerWidth || 1
            const xRatio = t.clientX / w
            if (xRatio < 0.18 || xRatio > 0.82) return
            if (isCompactRef.current) toggleChromeRef.current()
          }

          // 再注入一层 touch-action；iOS 用 manipulation，避免 pan-y 干扰选区手柄拖拽
          try {
            const style = contents.document.createElement('style')
            style.setAttribute('data-moyin-touch', '1')
            const touchAction = isAppleTouchDevice() ? 'manipulation' : 'pan-y pinch-zoom'
            style.textContent =
              `html,body{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:none!important;touch-action:${touchAction}!important;}`
            contents.document.head?.appendChild(style)
          } catch {
            /* ignore */
          }

          contents.document.addEventListener('contextmenu', onContextMenu)
          contents.document.addEventListener('selectionchange', onSelectionChange)
          contents.document.addEventListener('pointerdown', onPointerDownTrack, { passive: true })
          contents.document.addEventListener('pointermove', onPointerMoveTrack, { passive: true })
          contents.document.addEventListener('pointerup', onPointerUpSelect, { passive: true })
          contents.document.addEventListener('pointercancel', onPointerCancelSelect, { passive: true })
          contents.document.addEventListener('touchstart', onIframeTouchStart, { passive: true })
          contents.document.addEventListener('touchmove', onIframeTouchMove, { passive: false })
          // touchend：先划词/横滑（onTouchEndSelect），再点按工具栏
          contents.document.addEventListener('touchend', onTouchEndSelect, { passive: true })
          contents.document.addEventListener('touchend', onIframeTouchEndNav, { passive: true })
          contents.document.addEventListener('click', onLinkClickCapture, true)
          // 全部监听挂上后再标记，避免中途抛错导致永久跳过补绑
          selectionBoundDocs.add(contents.document)
        }
        rendition.hooks.content.register(attachSelectionHandlers)
        const rebindSelectionToContents = () => {
          const seen = new Set<Document>()
          try {
            const raw = rendition.getContents?.() as unknown
            const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as ContentsLike[]
            for (const c of list) {
              if (c?.document) seen.add(c.document)
              attachSelectionHandlers(c)
            }
          } catch {
            /* ignore */
          }
          // display 早于 hook / getContents 偶发为空：直接从 iframe 补一层 shim
          try {
            const iframes = viewerRef.current?.querySelectorAll('iframe') || []
            iframes.forEach((iframe) => {
              const doc = iframe.contentDocument
              const win = iframe.contentWindow
              if (!doc || !win || seen.has(doc)) return
              const shim: ContentsLike = {
                document: doc,
                window: win,
                cfiFromRange: (range: Range) => {
                  try {
                    const raw = rendition.getContents?.() as unknown
                    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as ContentsLike[]
                    const hit = list.find((c) => c.document === doc)
                    return hit?.cfiFromRange?.(range) || ''
                  } catch {
                    return ''
                  }
                },
              }
              attachSelectionHandlers(shim)
            })
          } catch {
            /* ignore */
          }
        }
        rebindSelectionToContents()
        // contents / iframe 可能略晚于 display resolve
        ;[200, 600, 1500, 3000].forEach((ms) => {
          window.setTimeout(rebindSelectionToContents, ms)
        })
        rendition.on('relocated', () => {
          rebindSelectionToContents()
          window.setTimeout(rebindSelectionToContents, 80)
          window.setTimeout(rebindSelectionToContents, 400)
        })
        try {
          ;(window as unknown as { __moyinRebind?: () => void }).__moyinRebind = rebindSelectionToContents
        } catch {
          /* ignore */
        }

        const clearEpubSelections = () => {
          clearDomSelection()
          try {
            const raw = rendition.getContents?.() as unknown
            const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { window?: Window }[]
            for (const c of list) clearDomSelection(c.window)
          } catch {
            /* ignore */
          }
          if (selectionRef.current) {
            selectionRef.current = null
            setSelection(null)
            setBasketPage('')
          }
          selectingRef.current = false
          lastPointerClientRef.current = null
          pointerStartRef.current = null
          pointerMovePxRef.current = 0
        }
        let lastTurnAt = 0
        const turnPrev = () => {
          if (isReaderPinchBlocking()) return
          const now = Date.now()
          if (now - lastTurnAt < 280) return
          lastTurnAt = now
          midSelectPinnedRef.current = false
          setMidSelectMode(false)
          clearEpubSelections()
          suppressProgressSaveRef.current = false
          rendition.prev()
        }
        const turnNext = () => {
          if (isReaderPinchBlocking()) return
          const now = Date.now()
          if (now - lastTurnAt < 280) return
          lastTurnAt = now
          midSelectPinnedRef.current = false
          setMidSelectMode(false)
          clearEpubSelections()
          suppressProgressSaveRef.current = false
          rendition.next()
        }
        turnPrevRef.current = turnPrev
        turnNextRef.current = turnNext
        const handleTapNavigate = (x: number, y: number, width: number, height: number) => {
          if (!width || !height) return
          // 左右由外层透明热区翻页；此处仅处理中央唤出工具栏
          const xRatio = x / width
          if (xRatio < 0.18 || xRatio > 0.82) return
          if (isCompactRef.current) {
            const yRatio = y / height
            if (yRatio < 0.18 || yRatio > 0.82) return
            toggleChromeRef.current()
          }
        }

        const markTouchNav = () => {
          lastTouchNavAt = Date.now()
          lastTouchNavAtRef.current = lastTouchNavAt
        }

        clickHandler = (event: MouseEvent, contents: { window: Window }) => {
          // 划词结束后的合成 click：绝不能关掉刚弹出的气泡 / 清掉选区
          if (Date.now() - lastPresentAt < 800) return
          if (Date.now() - lastTouchNavAt < 450) return
          // 选区刚变化（含拖手柄扩选）：忽略合成 click，避免长选区被清掉
          if (Date.now() - lastSelectionActivityAtRef.current < 1200) return
          if (selectingRef.current) return
          const target = event.target as HTMLElement | null
          if (target && target.closest('a, button, input, textarea, select')) return
          const win = contents?.window
          const current = selectionText(win)
          if (current) {
            const gestureMs = selectStartedAtRef.current
              ? Date.now() - selectStartedAtRef.current
              : undefined
            if (isAccidentalTapSelection(current, pointerMovePxRef.current, gestureMs)) {
              clearDomSelection(win)
            } else {
              // 有意选区：吞掉 click，保留选区
              return
            }
          }
          if (selectionRef.current) {
            selectionRef.current = null
            setSelection(null)
            setBasketPage('')
            clearDomSelection(win)
            return
          }
          setActiveHighlight(null)
          const width = win?.innerWidth || 0
          const height = win?.innerHeight || 0
          handleTapNavigate(event.clientX, event.clientY, width, height)
        }
        rendition.on('click', clickHandler)

        viewportClickHandler = (event: MouseEvent) => {
          if (Date.now() - lastTouchNavAt < 450) return
          if (event.target !== event.currentTarget) return
          if (selectionRef.current) return
          setActiveHighlight(null)
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
          handleTapNavigate(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height)
        }
        viewportEl = viewerWrapRef.current
        viewportEl?.addEventListener('click', viewportClickHandler)

        keyupHandler = (e: KeyboardEvent) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') turnPrev()
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') turnNext()
        }
        document.addEventListener('keyup', keyupHandler)

        // 滑屏翻页（外层 viewer；正文区主要靠 iframe 内手势）
        let touchStartX = 0
        let touchStartY = 0
        let viewerTouchMulti = false
        touchStartHandler = (e: TouchEvent) => {
          if (e.touches.length >= 2 || isReaderPinchBlocking()) {
            viewerTouchMulti = true
            markTouchGestureMulti()
            return
          }
          viewerTouchMulti = false
          const t = e.touches?.[0] || e.changedTouches?.[0]
          if (!t) return
          touchStartX = t.clientX
          touchStartY = t.clientY
        }
        touchEndHandler = (e: TouchEvent) => {
          if (viewerTouchMulti || e.touches.length >= 1 || isReaderPinchBlocking()) {
            if (e.touches.length === 0) viewerTouchMulti = false
            return
          }
          const t = e.changedTouches?.[0]
          if (!t) return
          // 选区面板打开或刚划过词：外层滑屏不翻页
          if (selectionRef.current) return
          if (Date.now() - lastSelectionActivityAtRef.current < 900) return
          const swipe = resolveHorizontalSwipe(
            { clientX: touchStartX, clientY: touchStartY },
            { clientX: t.clientX, clientY: t.clientY },
            isCompactRef.current
              ? { threshold: SWIPE_THRESHOLD_COMPACT_PX, axisRatio: SWIPE_AXIS_RATIO_COMPACT }
              : undefined,
          )
          if (!swipe.handled || !swipe.direction) return
          try {
            const rawContents = rendition.getContents?.() as unknown
            const list: ContentsLike[] = Array.isArray(rawContents)
              ? rawContents
              : rawContents
                ? [rawContents as ContentsLike]
                : []
            for (const c of list) clearDomSelection(c.window)
          } catch {
            /* ignore */
          }
          markTouchNav()
          if (swipe.direction === 'next') turnNext()
          else turnPrev()
        }
        viewerRef.current?.addEventListener('touchstart', touchStartHandler, { passive: true })
        viewerRef.current?.addEventListener('touchend', touchEndHandler, { passive: true })

        wheelHandler = (e: WheelEvent) => {
          if (!wheelEnabledRef.current) return
          // 输入框内滚轮不拦截
          const t = e.target as HTMLElement | null
          if (t && t.closest('input, textarea, select')) return
          if (Math.abs(e.deltaY) < 8) return
          const now = Date.now()
          if (now - lastWheelAtRef.current < 280) return
          lastWheelAtRef.current = now
          e.preventDefault()
          if (e.deltaY > 0) turnNext()
          else turnPrev()
        }
        viewerRef.current?.addEventListener('wheel', wheelHandler, { passive: false })
        rendition.hooks.content.register((contents: { document: Document }) => {
          contents.document.addEventListener(
            'wheel',
            (e: WheelEvent) => {
              if (!wheelEnabledRef.current) return
              if (Math.abs(e.deltaY) < 8) return
              const now = Date.now()
              if (now - lastWheelAtRef.current < 280) return
              lastWheelAtRef.current = now
              e.preventDefault()
              if (e.deltaY > 0) turnNext()
              else turnPrev()
            },
            { passive: false },
          )
        })
      } catch (err) {
        if (!cancelled) toast.error(err instanceof ApiError ? err.message : '打开电子书失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()

    return () => {
      cancelled = true
      if (keyupHandler) document.removeEventListener('keyup', keyupHandler)
      if (touchStartHandler) viewerRef.current?.removeEventListener('touchstart', touchStartHandler)
      if (touchEndHandler) viewerRef.current?.removeEventListener('touchend', touchEndHandler)
      if (wheelHandler) viewerRef.current?.removeEventListener('wheel', wheelHandler)
      if (viewportClickHandler && viewportEl) viewportEl.removeEventListener('click', viewportClickHandler)
      localRendition?.destroy()
      localEpub?.destroy()
      if (renditionRef.current === localRendition) renditionRef.current = null
      if (bookRef.current === localEpub) bookRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  function clearSearchHighlights() {
    if (searchFlashTimerRef.current) {
      clearTimeout(searchFlashTimerRef.current)
      searchFlashTimerRef.current = null
    }
    const rendition = renditionRef.current
    if (!rendition) {
      searchHighlightCfisRef.current = []
      return
    }
    for (const cfi of searchHighlightCfisRef.current) {
      try {
        rendition.annotations.remove(cfi, 'highlight')
      } catch {
        /* already gone */
      }
    }
    searchHighlightCfisRef.current = []
  }

  function scheduleClearSearchHighlights(durationMs = 4000) {
    if (searchFlashTimerRef.current) clearTimeout(searchFlashTimerRef.current)
    searchFlashTimerRef.current = setTimeout(() => {
      searchFlashTimerRef.current = null
      clearSearchHighlights()
    }, durationMs)
  }

  /** 在当前可见章节中高亮关键词；可选先跳到首个匹配。返回命中条数。 */
  async function flashSearchKeyword(
    keyword: string,
    opts?: { refineToKeyword?: boolean; durationMs?: number },
  ): Promise<number> {
    const rendition = renditionRef.current
    const raw = keyword.trim()
    if (!rendition || !raw) return 0

    type ContentsLike = { document: Document; cfiFromRange: (range: Range) => string }
    const getContents = (): ContentsLike[] => {
      const raw = rendition.getContents?.() as unknown
      if (Array.isArray(raw)) return raw as ContentsLike[]
      if (raw) return [raw as ContentsLike]
      return []
    }
    const terms = highlightTerms(raw)
    const tryKeywords = terms.length ? terms : [raw]

    const findInContents = (kw: string, limit = 40) => {
      const out: { contents: ContentsLike; range: Range }[] = []
      for (const contents of getContents()) {
        const root = contents.document.body || contents.document.documentElement
        if (!root) continue
        for (const range of findKeywordRanges(root, kw, limit - out.length)) {
          out.push({ contents, range })
          if (out.length >= limit) return out
        }
      }
      return out
    }

    let matchedKw = raw
    let hits = findInContents(raw)
    if (!hits.length) {
      for (const kw of tryKeywords) {
        hits = findInContents(kw)
        if (hits.length) {
          matchedKw = kw
          break
        }
      }
    }

    clearSearchHighlights()

    if (opts?.refineToKeyword !== false && hits[0]) {
      try {
        const firstCfi = hits[0].contents.cfiFromRange(hits[0].range) || ''
        if (firstCfi) {
          await rendition.display(firstCfi)
          await waitRenditionRendered(rendition)
          hits = findInContents(matchedKw)
        }
      } catch {
        /* keep chapter position */
      }
    }

    const cfis: string[] = []
    for (const { contents, range } of hits) {
      try {
        const cfi = contents.cfiFromRange(range)
        if (!cfi || cfis.includes(cfi)) continue
        rendition.annotations.highlight(
          cfi,
          {},
          undefined,
          'moyin-search-hl',
          {
            fill: '#ffb300',
            'fill-opacity': '0.65',
            'mix-blend-mode': 'multiply',
          },
        )
        cfis.push(cfi)
      } catch {
        /* skip */
      }
    }
    searchHighlightCfisRef.current = cfis
    if (cfis.length) scheduleClearSearchHighlights(opts?.durationMs ?? 4000)
    return cfis.length
  }
  flashSearchKeywordRef.current = flashSearchKeyword

  // 深链 ?cfi= / ?q=：定位章节并短暂高亮；EPUB 忽略误传的 pdf: 定位，改为按原文搜索
  useEffect(() => {
    if (loading || !renditionRef.current || !bookId) return
    let cfi = (searchParams.get('cfi') || '').trim()
    const q = (searchParams.get('q') || '').trim()
    if (cfi.startsWith('pdf:')) cfi = ''
    if (!cfi && !q) return
    const key = `${bookId}@@${cfi}@@${q}`
    if (lastFlashKeyRef.current === key) return
    lastFlashKeyRef.current = key
    // 会话中再次被引用/搜索定位：暂不改进度
    suppressProgressSaveRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        let target = cfi
        let flashQ = q
        if (!target && q) {
          const queries = [q.slice(0, 48), q.slice(0, 24), q.slice(0, 12)]
            .map((s) => s.trim())
            .filter((s, i, arr) => s.length >= 6 && arr.indexOf(s) === i)
          for (const query of queries) {
            if (cancelled) return
            try {
              const { results } = await api.get<{ results: SearchHit[] }>(
                `/api/search/book/${bookId}?q=${encodeURIComponent(query)}`,
              )
              const hit = (results?.[0]?.cfi_anchor || '').trim()
              if (hit) {
                target = hit
                flashQ = query
                break
              }
            } catch {
              /* try shorter */
            }
          }
        }
        if (!target || !renditionRef.current) return
        const prior = currentCfiRef.current
        if (prior && prior !== target) pushNavBackPoint()
        await renditionRef.current.display(target)
        if (!renditionRef.current) return
        await waitRenditionRendered(renditionRef.current)
        if (cancelled || !flashQ) return
        const n = await flashSearchKeywordRef.current(flashQ, { refineToKeyword: true, durationMs: 4000 })
        if (!cancelled && n === 0) toast.message('已跳转章节，未在当前页找到可高亮的匹配')
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
      if (lastFlashKeyRef.current === key) lastFlashKeyRef.current = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, bookId])

  /** 非翻页/页码跳转前压栈，供「返回原处」 */
  function pushNavBackPoint(): boolean {
    let cfi = currentCfiRef.current
    if (!cfi) {
      try {
        const loc = renditionRef.current?.currentLocation() as { start?: { cfi?: string } } | null
        cfi = loc?.start?.cfi || ''
      } catch {
        cfi = ''
      }
    }
    if (!cfi) return false
    const stack = navStackRef.current
    if (stack[stack.length - 1] !== cfi) stack.push(cfi)
    setCanNavBack(true)
    return true
  }

  function clearNavOrigin() {
    navStackRef.current = []
    setCanNavBack(false)
  }

  function epubContentsList(rendition: Rendition) {
    const raw = rendition.getContents?.() as unknown
    return (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{
      document: Document
      window?: Window
      cfiFromElement?: (el: Element) => string
      cfiFromRange?: (range: Range) => string
    }>
  }

  /** 把 TOC/内链 href 解析成 epubjs spine 可识别的候选（对齐 rendition.handleLinks） */
  function resolveEpubJumpCandidates(raw: string): string[] {
    const trimmed = (raw || '').trim()
    if (!trimmed) return []
    if (trimmed.startsWith('epubcfi(')) return [trimmed]

    const hashIdx = trimmed.indexOf('#')
    const hash = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : ''
    let pathPart = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed
    try {
      pathPart = decodeURIComponent(pathPart)
    } catch {
      /* keep */
    }

    const withHash = (p: string) => (hash ? `${p}#${hash}` : p)
    const out: string[] = []
    const add = (p?: string | null) => {
      const v = (p || '').trim()
      if (!v || out.includes(v)) return
      out.push(v)
    }

    add(trimmed)
    if (!pathPart && hash) {
      add(`#${hash}`)
      return out
    }

    add(pathPart)
    add(withHash(pathPart))

    const epubBook = bookRef.current
    if (epubBook && pathPart) {
      try {
        // 与 epubjs 内链一致：先 resolve 再相对到 package 目录
        const abs = epubBook.resolve(pathPart, false)
        if (abs) {
          const rel = epubBook.path.relative(abs)
          add(rel)
          add(withHash(rel))
        }
      } catch {
        /* ignore */
      }

      // 相对当前章节目录（部分 TOC 写的是章节内相对路径）
      const cur = currentHrefRef.current
      if (cur && !pathPart.startsWith('/') && !pathPart.includes('://')) {
        try {
          const baseDir = cur.includes('/') ? cur.replace(/\/[^/]*$/, '/') : ''
          const joined = joinEpubHref(baseDir, pathPart)
          add(joined)
          add(withHash(joined))
          const abs2 = epubBook.resolve(joined, false)
          if (abs2) {
            const rel2 = epubBook.path.relative(abs2)
            add(rel2)
            add(withHash(rel2))
          }
        } catch {
          /* ignore */
        }
      }
    }

    const baseName = pathPart.split('/').filter(Boolean).pop() || pathPart
    if (baseName && baseName !== pathPart) {
      add(baseName)
      add(withHash(baseName))
    }
    return out
  }

  async function jumpTo(target: string) {
    clearSearchHighlights()
    // 关掉目录/笔记等抽屉；跳转后保留顶底栏，方便继续导航
    setDrawerTab(null)
    setShowThemePicker(false)
    setChromeVisible(true)
    chromeToggleLockUntilRef.current = Date.now() + 800
    // 目录 / 高亮列表等主动跳转：算阅读行为，写入进度
    suppressProgressSaveRef.current = false

    const rendition = renditionRef.current
    const epubBook = bookRef.current
    if (!rendition || !target?.trim()) {
      toast.error('无法跳转到该章节')
      return
    }

    // 目录/笔记/内链式跳转前记下当前位置，供「返回原处」
    const pushed = pushNavBackPoint()
    const rollbackNav = () => {
      if (!pushed) return
      navStackRef.current.pop()
      setCanNavBack(navStackRef.current.length > 0)
    }

    const displayWithTimeout = (loc: string) =>
      Promise.race([
        rendition.display(loc),
        new Promise((_, reject) => setTimeout(() => reject(new Error('display timeout')), 8000)),
      ])

    const hash = target.includes('#') ? target.slice(target.indexOf('#') + 1) : ''
    const candidates = resolveEpubJumpCandidates(target)

    const finishJump = async (used: string) => {
      const usedHash = used.includes('#') ? used.slice(used.indexOf('#') + 1) : hash
      if (usedHash) {
        await waitRenditionRendered(rendition, 500)
        await scrollRenditionToHash(rendition, usedHash)
      }
      setChromeVisible(true)
      // 跳转成功后若此前没压到 CFI，再试一次用「跳转前」已无法取；至少保持工具栏
      if (pushed) setCanNavBack(true)
    }

    try {
      for (const cand of candidates) {
        try {
          await displayWithTimeout(cand)
          await finishJump(cand)
          return
        } catch {
          /* try next */
        }
      }

      // spine 精确 / 后缀匹配（部分 EPUB 的 TOC href 与 spine 路径不一致）
      if (epubBook) {
        const spine = epubBook.spine as {
          get?: (target: string | number) => { href?: string } | undefined
          spineItems?: Array<{ href?: string }>
          each?: (fn: (item: { href?: string }) => void) => void
        }
        const pathOnly = candidates.map((c) => c.split('#')[0]).filter(Boolean)
        for (const cand of pathOnly) {
          try {
            const section = spine.get?.(cand)
            if (section?.href) {
              const loc = hash ? `${section.href}#${hash}` : section.href
              await displayWithTimeout(loc)
              await finishJump(loc)
              return
            }
          } catch {
            /* try next */
          }
        }
        const items: Array<{ href?: string }> = []
        try {
          if (Array.isArray(spine.spineItems)) items.push(...spine.spineItems)
          else spine.each?.((item) => items.push(item))
        } catch {
          /* ignore */
        }
        for (const cand of pathOnly) {
          const baseName = cand.split('/').filter(Boolean).pop() || cand
          const hit = items.find((it) => {
            const href = (it.href || '').split('#')[0]
            return (
              href === cand ||
              href.endsWith('/' + baseName) ||
              href.endsWith(baseName) ||
              href.includes(baseName)
            )
          })
          if (!hit?.href) continue
          try {
            const loc = hash ? `${hit.href}#${hash}` : hit.href
            await displayWithTimeout(loc)
            await finishJump(loc)
            return
          } catch {
            /* try next */
          }
        }
      }

      rollbackNav()
      toast.error('无法跳转到该章节')
    } catch {
      rollbackNav()
      toast.error('无法跳转到该章节')
    }
  }

  async function scrollRenditionToHash(rendition: Rendition, hash: string) {
    if (!hash) return
    type ContentsLike = {
      document: Document
      cfiFromElement?: (el: Element) => string
    }
    const list = epubContentsList(rendition) as ContentsLike[]
    for (const contents of list) {
      let el: Element | null = null
      try {
        el =
          contents.document.getElementById(hash) ||
          contents.document.querySelector(`[name="${CSS.escape(hash)}"]`) ||
          contents.document.querySelector(`a[id="${CSS.escape(hash)}"]`)
      } catch {
        el = contents.document.getElementById(hash)
      }
      if (!el) continue
      try {
        if (typeof contents.cfiFromElement === 'function') {
          const cfi = contents.cfiFromElement(el)
          if (cfi) {
            await rendition.display(cfi)
            return
          }
        }
      } catch {
        /* fall through */
      }
      try {
        el.scrollIntoView({ block: 'start' })
      } catch {
        /* ignore */
      }
      return
    }
  }

  function waitRenditionRendered(rendition: Rendition, ms = 400) {
    return new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      const timer = window.setTimeout(finish, ms)
      try {
        rendition.once('rendered', () => {
          window.clearTimeout(timer)
          // 等一帧，确保 DOM/注释层就绪
          requestAnimationFrame(() => finish())
        })
      } catch {
        window.clearTimeout(timer)
        finish()
      }
    })
  }

  async function jumpToSearchHit(hit: SearchHit) {
    const rendition = renditionRef.current
    if (!rendition) return
    const keyword = searchHighlightQuery.trim() || searchQuery.trim()
    setDrawerTab(null)
    suppressProgressSaveRef.current = false
    const pushed = pushNavBackPoint()
    try {
      await rendition.display(hit.cfi_anchor || undefined)
      await waitRenditionRendered(rendition)
      if (!keyword) return
      const n = await flashSearchKeyword(keyword, { refineToKeyword: true, durationMs: 4000 })
      if (n === 0) toast.message('已跳转章节，未在当前页找到可高亮的匹配')
    } catch (err) {
      if (pushed) {
        navStackRef.current.pop()
        setCanNavBack(navStackRef.current.length > 0)
      }
      toast.error(err instanceof Error ? err.message : '跳转失败')
    }
  }

  function jumpToPage(raw?: string) {
    const epubBook = bookRef.current
    if (!epubBook || totalPages <= 0) return
    const n = Number.parseInt((raw ?? pageInput).trim(), 10)
    if (!Number.isFinite(n)) {
      setPageInput(String(currentPage))
      return
    }
    const page = Math.min(totalPages, Math.max(1, n))
    setPageInput(String(page))
    suppressProgressSaveRef.current = false
    try {
      if (pageSourceRef.current === 'print') {
        const cfi = epubBook.pageList.cfiFromPage(page) as unknown
        if (cfi != null && cfi !== -1 && String(cfi)) {
          renditionRef.current?.display(String(cfi))
          return
        }
      }
      if (pageSourceRef.current === 'estimate' && totalPages > 0) {
        const pct = Math.min(0.999, Math.max(0, (page - 0.5) / totalPages))
        const cfi = epubBook.locations.length()
          ? epubBook.locations.cfiFromPercentage(pct)
          : null
        if (cfi) {
          renditionRef.current?.display(cfi)
          return
        }
      }
      const cfi = epubBook.locations.cfiFromLocation(page - 1)
      if (cfi) renditionRef.current?.display(cfi)
    } catch {
      toast.error('跳转失败，请稍后再试')
    }
  }

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === shellRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => {
    // 进入全屏：沉浸式隐藏顶/底栏；退出全屏（无论是按钮触发还是系统 Esc/手势触发）
    // 都必须把顶/底栏找回来——否则用户退出全屏后会发现工具栏"消失了"，
    // 只能靠盲点单击屏幕中间去猜怎么把它调出来。
    setChromeVisible(!isFullscreen)
  }, [isFullscreen])

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await shellRef.current?.requestFullscreen()
      }
    } catch {
      toast.error('当前浏览器不支持全屏，或已被拒绝')
    }
  }

  function applyReaderTheme(themeId: string, customHex?: string) {
    setReaderThemeId(themeId)
    localStorage.setItem('moyin_reader_theme', themeId)
    const prefsPatch: Record<string, string> = { reader_theme: themeId }
    const effectiveBg = themeId === 'custom' ? customHex ?? customBg : customBg
    if (themeId === 'custom' && customHex) {
      setCustomBg(customHex)
      localStorage.setItem('moyin_reader_bg_custom', customHex)
      prefsPatch.reader_bg_custom = customHex
    }
    if (user) void updatePreferences(prefsPatch)
    const colors = resolveReaderTheme(themeId, effectiveBg)
    const rendition = renditionRef.current
    if (rendition) {
      const bodyFont = readerFontFamilyCss(readerFontRef.current)
      rendition.themes.default({
        '::selection': { background: 'rgba(216,169,78,0.35)' },
        body: {
          'font-family': `${bodyFont} !important`,
          background: `${colors.bg} !important`,
          color: `${colors.fg} !important`,
          '-webkit-user-select': 'text !important',
          'user-select': 'text !important',
        },
        'p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, a': {
          'font-family': `${bodyFont} !important`,
          '-webkit-user-select': 'text !important',
          'user-select': 'text !important',
          color: `${colors.fg} !important`,
        },
      })
      // themes.default 后重新施加字号，避免被主题覆盖后看起来「没反应」
      rendition.themes.fontSize(`${fontSizeRef.current}%`)
    }
    if (viewerRef.current) viewerRef.current.style.background = colors.bg
  }

  // 界面设置里的「阅读字体」变更时，立即同步到 EPUB 正文
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return

    const applyFontTheme = () => {
      const bodyFont = readerFontFamilyCss(readerFont)
      const colors = resolveReaderTheme(readerThemeId, customBg)
      try {
        // 当前已打开的章节 iframe 补注入字体
        const raw = rendition.getContents?.() as
          | { document?: Document }
          | Array<{ document?: Document }>
          | undefined
        const list = !raw ? [] : Array.isArray(raw) ? raw : [raw]
        for (const c of list) {
          if (c?.document) injectEpubReaderFonts(c.document)
        }
        rendition.themes.default({
          '::selection': { background: 'rgba(216,169,78,0.35)' },
          body: {
            'font-family': `${bodyFont} !important`,
            background: `${colors.bg} !important`,
            color: `${colors.fg} !important`,
            '-webkit-user-select': 'text !important',
            'user-select': 'text !important',
          },
          'p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, a': {
            'font-family': `${bodyFont} !important`,
            '-webkit-user-select': 'text !important',
            'user-select': 'text !important',
            color: `${colors.fg} !important`,
          },
        })
        rendition.themes.fontSize(`${fontSizeRef.current}%`)
      } catch {
        /* rendition 可能已销毁 */
      }
    }

    applyFontTheme()
    // 字体 data-URI 就绪后再刷一次，避免先回退到系统黑体
    void loadEpubReaderFontFaceCss().then(applyFontTheme)
  }, [readerFont, readerThemeId, customBg])

  async function saveNote(content: string) {
    setNoteContent(content)
    setNoteSaveState('saving')
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current)
    noteSaveTimerRef.current = setTimeout(async () => {
      try {
        await api.put(`/api/notes/${bookId}`, { content })
        setNoteSaveState('saved')
      } catch {
        setNoteSaveState('idle')
      }
    }, 700)
  }

  function persistFontSize(nextRaw: number) {
    const next = Math.min(180, Math.max(70, Math.round(nextRaw)))
    setFontSize(next)
    fontSizeRef.current = next
    try {
      localStorage.setItem('moyin_reader_font_size', String(next))
    } catch {
      /* private mode */
    }
    if (user) void updatePreferences({ reader_font_size: next })
    try {
      renditionRef.current?.themes.fontSize(`${next}%`)
    } catch {
      /* ignore */
    }
    return next
  }

  function changeFontSize(delta: number) {
    persistFontSize(fontSizeRef.current + delta)
  }

  // 点空白关闭背景面板
  useEffect(() => {
    if (!showThemePicker) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('.theme-popover, .reader-topbar-right')) return
      setShowThemePicker(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [showThemePicker])

  function goNavBack() {
    const cfi = navStackRef.current.pop()
    setCanNavBack(navStackRef.current.length > 0)
    if (cfi) {
      void renditionRef.current?.display(cfi)
    }
  }

  function dismissNavOrigin() {
    clearNavOrigin()
  }

  function clearAllEpubSelections() {
    clearDomSelection()
    try {
      const raw = renditionRef.current?.getContents?.() as unknown
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as { window?: Window }[]
      for (const c of list) clearDomSelection(c.window)
    } catch {
      /* ignore */
    }
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
  }

  function handleTapZone(action: 'prev' | 'next') {
    midSelectPinnedRef.current = false
    setMidSelectMode(false)
    clearAllEpubSelections()
    setActiveHighlight(null)
    if (action === 'prev') turnPrevRef.current()
    else turnNextRef.current()
  }

  function suppressTapZonePointer(e: React.PointerEvent | React.MouseEvent) {
    // 勿 preventDefault：会吞掉后续 click；热区已盖在 iframe 上
    e.stopPropagation()
    clearAllEpubSelections()
  }

  async function createHighlight(color: string, note = '') {
    if (!selection || !bookId) return
    if (!selection.cfiRange || selection.cfiRange.startsWith('mobile-')) {
      toast.error('未能定位选区，请重新划选后再高亮')
      return
    }
    try {
      const h = await api.post<Highlight>('/api/highlights', {
        book_id: bookId,
        cfi_range: selection.cfiRange,
        color,
        quoted_text: selection.text,
        note,
        chapter_title: findChapterTitle(toc, currentHrefRef.current),
        page_no: basketPage.trim(),
      })
      setHighlights((prev) => [...prev, h])
      applyHighlightAnnotation(h)
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
    const epubBook = bookRef.current
    const rendition = renditionRef.current
    if (!epubBook || !rendition || totalPages <= 0) return
    suppressProgressSaveRef.current = false
    if (scrubOriginPendingRef.current) {
      pushNavBackPoint()
      scrubOriginPendingRef.current = false
    }
    const pct = Math.min(0.999, Math.max(0, nextPercent / 100))
    try {
      if (epubBook.locations.length()) {
        const cfi = epubBook.locations.cfiFromPercentage(pct)
        if (cfi) {
          void rendition.display(cfi)
          setPercent(Math.round(nextPercent))
          return
        }
      }
      const page = Math.min(totalPages, Math.max(1, Math.round((nextPercent / 100) * totalPages)))
      jumpToPage(String(page))
    } catch {
      /* ignore scrub glitches */
    }
  }

  async function addToBasket(targetProjectId?: string) {
    if (!selection) return
    const locator = epubPersistableLocator(selection.cfiRange)
    const ok = await addToBasketCore({ text: selection.text, locator }, targetProjectId)
    if (ok) dismissSelection()
  }

  async function addToNewBasket(name: string) {
    if (!selection) return
    const locator = epubPersistableLocator(selection.cfiRange)
    const ok = await addToNewBasketCore({ text: selection.text, locator }, name)
    if (ok) dismissSelection()
  }

  function dismissSelection(opts?: { keepAnnotate?: boolean }) {
    clearAllEpubSelections()
    bubbleInteractingRef.current = false
    // 主动关闭功能条时退出临时划词并恢复翻页；保留钉住的顶栏划词态
    if (opts?.keepAnnotate) {
      if (!midSelectPinnedRef.current) setMidSelectMode(false)
      return
    }
    midSelectPinnedRef.current = false
    setMidSelectMode(false)
  }

  function clearEpubPinchTransform() {
    const el = viewerRef.current
    if (!el) return
    el.style.transform = ''
    el.style.willChange = ''
  }

  /** 双指过程中跟手改真实字号（不写偏好）；步进之间用微量 CSS scale 补间保持丝滑 */
  function applyEpubPinchPreview(factor: number, originValue: number) {
    const raw = Math.min(180, Math.max(70, originValue * factor))
    const stepped = Math.round(raw / 2) * 2
    const hud = Math.round(raw)
    setPinchHud(hud)

    if (stepped !== pinchAppliedRef.current) {
      pinchAppliedRef.current = stepped
      fontSizeRef.current = stepped
      setFontSize(stepped)
      try {
        renditionRef.current?.themes.fontSize(`${stepped}%`)
      } catch {
        /* ignore */
      }
    }

    const el = viewerRef.current
    if (!el || pinchAppliedRef.current <= 0) return
    // 相对已应用字号的残余缩放，只补步进之间的缝隙（通常 <2%）
    const residual = raw / pinchAppliedRef.current
    el.style.willChange = 'transform'
    el.style.transformOrigin = 'top center'
    if (Math.abs(residual - 1) > 0.006) {
      el.style.transform = `scale(${residual})`
    } else {
      el.style.transform = ''
    }
  }

  usePinchZoom(viewerWrapRef, {
    enabled: isCompact && !loading,
    previewOnly: true,
    getValue: () => fontSizeRef.current,
    setValue: (next) => {
      clearEpubPinchTransform()
      persistFontSize(next)
      setPinchHud(null)
    },
    onPreview: (factor, originValue) => {
      applyEpubPinchPreview(factor, originValue)
    },
    min: 70,
    max: 180,
    step: 2,
    onPinchStart: () => {
      pinchAppliedRef.current = fontSizeRef.current
      setPinchHud(fontSizeRef.current)
      midSelectPinnedRef.current = false
      setMidSelectMode(false)
      clearAllEpubSelections()
    },
    onPinchEnd: () => {
      clearEpubPinchTransform()
      setPinchHud(null)
    },
  })

  async function deleteHighlight(h: Highlight) {
    try {
      await api.delete(`/api/highlights/${h.id}`)
      renditionRef.current?.annotations.remove(h.cfi_range, 'highlight')
      setHighlights((prev) => prev.filter((x) => x.id !== h.id))
      setActiveHighlight(null)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissSelection()
        setActiveHighlight(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function runSearch() {
    const q = searchQuery.trim()
    if (!q || !bookId) return
    clearSearchHighlights()
    setSearching(true)
    try {
      const { results } = await api.get<{ results: SearchHit[] }>(
        `/api/search/book/${bookId}?q=${encodeURIComponent(q)}`,
      )
      setSearchHighlightQuery(q)
      setSearchResults(results)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }

  function renderProgressJump() {
    return (
      <div
        className="reader-progress-jump"
        title={
          pageSource === 'print'
            ? '纸书页码（来自 EPUB 内嵌页码表），可直接用于脚注'
            : pageSource === 'estimate'
              ? '按元数据总页数×进度估算的纸书页，脚注请再核对'
              : pagesBuilding
                ? '正在扫描全书…'
                : '虚拟页码，仅供导航；脚注请填写纸质书页码'
        }
      >
        <span className="reader-progress-label">
          {pageSource === 'print' ? '纸书' : pageSource === 'estimate' ? '约' : '页'}
        </span>
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
          disabled={!pagesReady}
        />
        <span className="reader-progress-meta">
          / {pagesReady ? totalPages : pagesBuilding ? '…' : '—'} · {percent}%
        </span>
      </div>
    )
  }

  const journalPaper = resolveReaderTheme(readerThemeId, customBg)

  return (
    <div className={`reader-shell${chromeVisible ? '' : ' chrome-hidden'}`} ref={shellRef}>
      <div
        className="reader-topbar"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reader-topbar-left">
          <button className="icon-btn" onClick={() => exitReader(navigate)} title="返回" aria-label="返回">
            <ArrowLeft size={18} />
          </button>
          <ReaderBookIdentity
            bookId={book?.id || bookId}
            title={book?.title}
            authors={book?.authors}
            coverUrl={book?.cover_url}
            coverOnly={isCompact}
          />
        </div>

        <div className="reader-topbar-right">
          {!isCompact && (
            <button className="icon-btn reader-desktop-only" onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏阅读'}>
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          )}
          <button
            className={`icon-btn ${drawerTab === 'search' ? 'active' : ''}`}
            onClick={() => {
              setShowThemePicker(false)
              setDrawerTab((v) => (v === 'search' ? null : 'search'))
            }}
            title="书内搜索"
          >
            <Search size={18} />
          </button>
          {!isCompact && (
            <div className="reader-font-quick" title="字号">
              <button
                type="button"
                className="icon-btn reader-font-quick-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  changeFontSize(-10)
                }}
                aria-label="缩小字号"
                title="缩小字号"
              >
                <span className="reader-aa-icon reader-aa-sm" aria-hidden>
                  A
                </span>
              </button>
              <span className="reader-font-quick-value">{fontSize}%</span>
              <button
                type="button"
                className="icon-btn reader-font-quick-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  changeFontSize(10)
                }}
                aria-label="放大字号"
                title="放大字号"
              >
                <span className="reader-aa-icon reader-aa-lg" aria-hidden>
                  A
                </span>
              </button>
            </div>
          )}
          <button
            className={`icon-btn ${showThemePicker ? 'active' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setShowThemePicker((v) => !v)
              setDrawerTab(null)
            }}
            title="显示设置（字体 / 字号 / 背景）"
            aria-label="显示设置"
          >
            <Type size={18} />
          </button>
          <button
            className={`icon-btn ${drawerTab === 'toc' ? 'active' : ''}`}
            onClick={() => {
              setShowThemePicker(false)
              setDrawerTab((v) => (v === 'toc' ? null : 'toc'))
            }}
            title="目录"
          >
            <List size={18} />
          </button>
          {isCompact && (
            <button
              type="button"
              className={`icon-btn${midSelectMode ? ' active' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setShowThemePicker(false)
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
              setShowThemePicker(false)
              setDrawerTab((v) => (v === 'notes' ? null : 'notes'))
            }}
            title="高亮与笔记"
          >
            <Highlighter size={18} />
          </button>
          {!isCompact && (
            <button
              className={`icon-btn ${drawerTab === 'translate' ? 'active' : ''}`}
              onClick={() => {
                setShowThemePicker(false)
                setDrawerTab((v) => (v === 'translate' ? null : 'translate'))
              }}
              title="划词翻译"
            >
              <Languages size={18} />
            </button>
          )}
          <button
            className={`icon-btn ${drawerTab === 'journal' ? 'active' : ''}`}
            onClick={() => {
              setShowThemePicker(false)
              setDrawerTab((v) => (v === 'journal' ? null : 'journal'))
            }}
            title="写笔记（Markdown）"
          >
            <NotebookPen size={18} />
          </button>
          {!isCompact && (
            <button
              className={`icon-btn reader-desktop-only ${layoutMode === 'a4' ? 'active' : ''}`}
              onClick={() => {
                const next = layoutMode === 'a4' ? 'full' : 'a4'
                setLayoutMode(next)
                localStorage.setItem('moyin_reader_layout', next)
                // 立即排一次：等 React 提交 class 后再用 effect 补齐
                window.requestAnimationFrame(() => {
                  const r = renditionRef.current
                  const el = viewerRef.current
                  if (!r || !el) return
                  try {
                    r.resize(el.clientWidth, el.clientHeight)
                  } catch {
                    /* ignore */
                  }
                })
              }}
              title={layoutMode === 'a4' ? '切换为全宽显示' : '切换为 A4 居中显示'}
            >
              {layoutMode === 'a4' ? <PanelsTopLeft size={18} /> : <RectangleHorizontal size={18} />}
            </button>
          )}

        </div>
      </div>

      {showThemePicker && (
        <div
          className="theme-popover"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="theme-popover-title">阅读字体</div>
          <div className="theme-font-family-row" role="group" aria-label="阅读字体">
            {READER_FONT_OPTIONS.map((f) => {
              const selected = readerFont === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`theme-font-family-btn${selected ? ' active' : ''}`}
                  style={{ fontFamily: f.fontFamily }}
                  title={f.label}
                  aria-pressed={selected}
                  onClick={() => setReaderFont(f.id)}
                >
                  <span className="theme-font-family-sample">字</span>
                  <span className="theme-font-family-label">{f.shortLabel}</span>
                </button>
              )
            })}
          </div>
          <div className="theme-popover-title">字号</div>
          <div className="theme-font-row">
            <button type="button" className="icon-btn" onClick={() => changeFontSize(-10)} aria-label="缩小字号">
              <Minus size={16} />
            </button>
            <span className="theme-font-value">{fontSize}%</span>
            <button type="button" className="icon-btn" onClick={() => changeFontSize(10)} aria-label="放大字号">
              <Plus size={16} />
            </button>
          </div>
          <div className="theme-popover-title">阅读背景</div>
          <div className="theme-swatch-row">
            {READER_THEMES.map((t) => (
              <div
                key={t.id}
                className={`theme-swatch ${readerThemeId === t.id ? 'active' : ''}`}
                style={{ background: t.bg, border: `1px solid ${t.fg}22` }}
                title={t.label}
                onClick={() => applyReaderTheme(t.id)}
              >
                {readerThemeId === t.id && <Check size={13} color={t.fg} />}
              </div>
            ))}
            <label className={`theme-swatch theme-swatch-custom ${readerThemeId === 'custom' ? 'active' : ''}`} title="自定义颜色">
              <input type="color" value={customBg} onChange={(e) => applyReaderTheme('custom', e.target.value)} />
            </label>
          </div>
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

      <ReaderReturnOriginBar visible={canNavBack} onReturn={goNavBack} onDismiss={dismissNavOrigin} />

      <div className={`reader-body${drawerTab ? ' reader-body-drawer-open' : ''}`}>
        <div
          ref={viewerWrapRef}
          className={`reader-viewport ${layoutMode === 'a4' ? 'layout-a4' : 'layout-full'}`}
        >
          {loading && (
            <div className="empty-state" style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
              <div className="spinner" />
            </div>
          )}
          <div ref={viewerRef} className="epub-viewer" />

          {pinchHud != null && (
            <div className="reader-pinch-hud" aria-live="polite" aria-atomic="true">
              <span className="reader-pinch-hud-value">{pinchHud}</span>
              <span className="reader-pinch-hud-unit">%</span>
              <span className="reader-pinch-hud-label">字号</span>
            </div>
          )}

          {isCompact && !midSelectMode && !selection && !loading && (
            <ReaderMidSwipeLayer
              onPrev={() => turnPrevRef.current()}
              onNext={() => turnNextRef.current()}
              onTap={() => toggleChromeRef.current()}
              onLongPressSelect={() => enterAnnotateMode({ pinned: false })}
            />
          )}

          {/* 有选区时热区让位；无选区即使曾进划词也保留左右翻页 */}
          {!loading && !(isCompact && selection) && (
            <>
              <div
                className={`reader-tap-zone left${isCompact ? ' reader-tap-zone-compact' : ''}`}
                aria-hidden
                onPointerDown={suppressTapZonePointer}
                onMouseDown={suppressTapZonePointer}
                onClick={(e) => {
                  e.stopPropagation()
                  handleTapZone('prev')
                }}
              />
              <div
                className={`reader-tap-zone right${isCompact ? ' reader-tap-zone-compact' : ''}`}
                aria-hidden
                onPointerDown={suppressTapZonePointer}
                onMouseDown={suppressTapZonePointer}
                onClick={(e) => {
                  e.stopPropagation()
                  handleTapZone('next')
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
              pagePlaceholder="纸书页"
              pageTitle={
                pageSource === 'print'
                  ? '已填入 EPUB 纸书页，可改'
                  : pageSource === 'estimate'
                    ? '已填入估算页，请按纸书核对'
                    : '请填写要引用的纸质书页码'
              }
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
              containerWidth={viewerWrapRef.current?.clientWidth || 360}
              containerHeight={viewerWrapRef.current?.clientHeight || 640}
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
                setShowThemePicker(false)
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

        {drawerTab === 'journal' && (
          <ReaderJournalPanel
            noteContent={noteContent}
            onChange={(v) => void saveNote(v)}
            noteSaveState={noteSaveState}
            journalMode={journalMode}
            setJournalMode={setJournalMode}
            onClose={() => {
              setDrawerTab(null)
              setChromeVisible(true)
              chromeToggleLockUntilRef.current = Date.now() + 500
            }}
            paperBg={journalPaper.bg}
            paperFg={journalPaper.fg}
            width={journalWidth}
            onResizePointerDown={onJournalResizePointerDown}
            showResize={!isCompact}
          />
        )}

        {drawerTab && drawerTab !== 'journal' && (
          <div className="reader-drawer">
            <div className="reader-drawer-header">
              <div style={{ fontWeight: 700 }}>
                {drawerTab === 'toc' && '目录'}
                {drawerTab === 'notes' && '本书笔记目录'}
                {drawerTab === 'search' && '书内搜索'}
                {drawerTab === 'translate' && '划词翻译'}
              </div>
              <button
                className="icon-btn"
                onClick={() => {
                  setDrawerTab(null)
                  setChromeVisible(true)
                  chromeToggleLockUntilRef.current = Date.now() + 500
                }}
              >
                <X size={16} />
              </button>
            </div>

            {drawerTab === 'toc' && (
              <div className="reader-toc-list">
                {flattenToc(toc).map(({ item, depth }) => {
                  const isActive = Boolean(currentHref) && item.href.split('#')[0] === currentHref.split('#')[0]
                  return (
                  <button
                    key={item.id + item.href}
                    type="button"
                    className={`reader-toc-item${isActive ? ' active' : ''}`}
                    style={{ paddingLeft: 16 + depth * 14 }}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const href = (item.href || '').trim()
                      if (!href) {
                        toast.error('该目录项没有有效链接')
                        return
                      }
                      void jumpTo(href)
                    }}
                  >
                    {item.label?.trim() || '未命名章节'}
                  </button>
                  )
                })}
                {toc.length === 0 && <div className="empty-state">该书暂无目录信息</div>}
              </div>
            )}

            {drawerTab === 'notes' && (
              <div>
                {highlights.length === 0 && <div className="empty-state">还没有高亮或笔记，选中正文文字即可创建</div>}
                {highlights.map((h) => (
                  <div
                    key={h.id}
                    className="highlight-item"
                    style={{ borderLeft: `3px solid ${h.color || 'transparent'}` }}
                    onClick={() => void jumpTo(h.cfi_range)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 11.5, color: 'var(--reader-muted)' }}>
                        <span className="highlight-swatch" style={{ background: h.color }} />
                        {h.chapter_title || '未分章'}
                      </div>
                      <button
                        className="icon-btn"
                        style={{ width: 24, height: 24 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteHighlight(h)
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.6 }}>{h.quoted_text}</div>
                    {h.note && (
                      <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--reader-accent)' }}>笔记：{h.note}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {drawerTab === 'search' && (
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    placeholder="搜索本书关键词…"
                  />
                  <button className="btn btn-primary btn-sm" onClick={runSearch} disabled={searching}>
                    <Search size={14} />
                  </button>
                </div>
                <div style={{ marginTop: 14 }}>
                  {searching && (
                    <div className="empty-state">
                      <div className="spinner" />
                    </div>
                  )}
                  {!searching &&
                    searchResults.map((r, i) => (
                      <div key={i} className="highlight-item" onClick={() => void jumpToSearchHit(r)}>
                        <div style={{ fontSize: 11.5, color: 'var(--reader-muted)' }}>{r.chapter_title}</div>
                        <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                          <HighlightedText text={r.snippet} query={searchHighlightQuery} />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {drawerTab === 'translate' && (
              <ReaderTranslatePanel entry={translatePanel} onExplain={askExplain} />
            )}

          </div>
        )}
      </div>

      <div
        className={`reader-bottombar${isCompact && selection ? ' is-selecting' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
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
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              turnPrevRef.current()
              setChromeVisible(true)
            }}
            aria-label="上一页"
          >
            <ChevronLeft size={18} />
          </button>
          {renderProgressJump()}
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              turnNextRef.current()
              setChromeVisible(true)
            }}
            aria-label="下一页"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div ref={setSelectionChromeEl} className="reader-bottombar-selection" />
      </div>
    </div>
  )
}
