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
  List,
  Maximize,
  Minimize,
  Minus,
  NotebookPen,
  Palette,
  PanelsTopLeft,
  Plus,
  RectangleHorizontal,
  Search,
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
import {
  clearDomSelection,
  isIntentionalTextSelection,
  pointerTravel,
  selectionText,
} from '../lib/readerGestures'
import {
  pointerToViewport,
  rangeToSelectionAnchor,
  withPointer,
} from '../lib/selectionBubblePlacement'
import { findKeywordRanges } from '../lib/findKeywordRanges'
import { HighlightedText, highlightTerms } from '../lib/highlightQuery'
import { useJournalDrawerWidth } from '../lib/useJournalDrawerWidth'
import { useReaderChromeInset } from '../lib/useReaderChromeInset'
import PdfReaderPage from './PdfReaderPage'

/** EPUB 无固定纸书页码；用字符块生成虚拟页。约 720 字更接近一屏中文阅读量。 */
const EPUB_LOC_CHARS = 720

function epubLocCacheKey(bookId: string) {
  return `moyin_epub_locs_v2_${bookId}_${EPUB_LOC_CHARS}`
}

function loadCachedEpubLocations(bookId: string): string | null {
  try {
    return localStorage.getItem(epubLocCacheKey(bookId))
  } catch {
    return null
  }
}

function saveCachedEpubLocations(bookId: string, json: string) {
  try {
    localStorage.setItem(epubLocCacheKey(bookId), json)
  } catch {
    /* quota / private mode */
  }
}

const READER_THEMES = [
  { id: 'paper', label: '米白', bg: '#f4ecd8', fg: '#2b2620' },
  { id: 'white', label: '纯白', bg: '#ffffff', fg: '#1c1c1c' },
  { id: 'sepia', label: '护眼', bg: '#eee3ca', fg: '#3a3226' },
  { id: 'mint', label: '薄荷', bg: '#dcece6', fg: '#1f322b' },
  { id: 'dark', label: '深灰', bg: '#2a2a2a', fg: '#d8d3c8' },
  { id: 'black', label: '纯黑', bg: '#000000', fg: '#b8b8b8' },
]

type DrawerTab = 'toc' | 'notes' | 'search' | 'journal' | null

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

function flattenToc(items: NavItem[], depth = 0): { item: NavItem; depth: number }[] {
  return items.flatMap((item) => [{ item, depth }, ...flattenToc(item.subitems || [], depth + 1)])
}

/** 合并 EPUB 相对路径（处理 ../） */
function joinEpubHref(baseDir: string, rel: string): string {
  if (!rel) return baseDir.replace(/\/$/, '')
  if (rel.startsWith('#') || rel.startsWith('epubcfi(') || /^(https?:|mailto:)/i.test(rel)) return rel
  const raw = rel.startsWith('/') ? rel.replace(/^\/+/, '') : `${baseDir}${rel}`
  const stack: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
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
  const currentCfiRef = useRef<string>('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [book, setBook] = useState<BookDetail | null>(null)
  const [toc, setToc] = useState<NavItem[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [projects, setProjects] = useState<CitationProject[]>([])
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlightState | null>(null)
  const [basketProjectId, setBasketProjectId] = useState('')
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeVisibleRef = useRef(true)
  /** 关抽屉后短暂锁定，避免点击穿透把顶底栏又藏掉 */
  const chromeToggleLockUntilRef = useRef(0)
  const toggleChromeRef = useRef(() => {})
  const isCompactRef = useRef(false)

  toggleChromeRef.current = () => {
    if (Date.now() < chromeToggleLockUntilRef.current) return
    setChromeVisible((v) => !v)
  }
  const selectionRef = useRef<SelectionState | null>(null)
  const bubbleInteractingRef = useRef(false)
  const selectingRef = useRef(false)
  const lastPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const pointerMovePxRef = useRef(0)
  const viewerWrapRef = useRef<HTMLDivElement | null>(null)
  const [basketPage, setBasketPage] = useState('')
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
  const [fontSize, setFontSize] = useState(() => {
    const fromUser = Number(user?.preferences?.reader_font_size)
    if (fromUser >= 70 && fromUser <= 180) return fromUser
    const fromLocal = Number(localStorage.getItem('moyin_reader_font_size'))
    if (fromLocal >= 70 && fromLocal <= 180) return fromLocal
    return 100
  })
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 860px)').matches : false,
  )
  const [canNavBack, setCanNavBack] = useState(false)
  const navStackRef = useRef<string[]>([])
  const turnPrevRef = useRef<() => void>(() => {})
  const turnNextRef = useRef<() => void>(() => {})
  const fontSizeRef = useRef(fontSize)

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    chromeVisibleRef.current = chromeVisible
  }, [chromeVisible])

  useEffect(() => {
    fontSizeRef.current = fontSize
  }, [fontSize])

  useReaderChromeInset(shellRef)
  const { width: journalWidth, onResizePointerDown: onJournalResizePointerDown } = useJournalDrawerWidth()

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
  }, [fontSize])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const sync = () => {
      isCompactRef.current = mq.matches
      setIsCompact(mq.matches)
      // 移动端固定 A4 版式，不提供全宽切换
      if (mq.matches) setLayoutMode('a4')
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
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
        const [detail, hs, projs, progress, note] = await Promise.all([
          api.get<BookDetail>(`/api/books/${bookId}`),
          api.get<Highlight[]>(`/api/highlights/book/${bookId}`),
          api.get<CitationProject[]>('/api/citation/projects'),
          api.get<{ location: string; percent: number }>(`/api/books/${bookId}/progress`),
          api.get<BookNote>(`/api/notes/${bookId}`).catch(() => ({ content: '' }) as BookNote),
        ])
        if (cancelled) return
        setBook(detail)
        metaPageCountRef.current = Number(detail.page_count) || 0
        setHighlights(hs)
        setProjects(projs)
        setBasketProjectId(pickDefaultBasketProjectId(projs))
        // 后端存的是 0~1 小数；历史数据偶发存成 0~100，这里兼容两种
        const rawPct = Number(progress.percent) || 0
        setPercent(Math.round(rawPct <= 1 ? rawPct * 100 : rawPct))
        setNoteContent(note.content || '')

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
        rendition.themes.default({
          '::selection': { background: 'rgba(216,169,78,0.35)' },
          body: {
            'font-family': "'Noto Serif SC', serif !important",
            background: `${themeColors.bg} !important`,
            color: `${themeColors.fg} !important`,
            /* iOS 需显式允许选字，否则划词无选区、气泡出不来 */
            '-webkit-user-select': 'text !important',
            'user-select': 'text !important',
            '-webkit-touch-callout': 'default !important',
          },
          'p, div, span, li, td, th, h1, h2, h3, h4, h5, h6, a': {
            '-webkit-user-select': 'text !important',
            'user-select': 'text !important',
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
        // 失效 CFI 会导致 display 挂起，加超时并回退到首页
        // restart=1：重新阅读，忽略已存进度并从开头开始
        const jumpCfi = searchParams.get('cfi')
        const restart = searchParams.get('restart') === '1'
        const target = jumpCfi || (restart ? undefined : progress.location) || undefined
        const displayWithTimeout = (loc?: string) =>
          Promise.race([
            rendition.display(loc),
            new Promise((_, reject) => setTimeout(() => reject(new Error('display timeout')), 8000)),
          ])
        try {
          await displayWithTimeout(target)
        } catch {
          if (target) {
            try {
              await displayWithTimeout(undefined)
            } catch {
              /* ignore */
            }
          }
        }
        if (cancelled) return

        epub.loaded.navigation.then((nav) => {
          if (!cancelled) setToc(nav.toc)
        })

        hs.forEach(applyHighlightAnnotation)

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
        const bootLocations = async () => {
          try {
            await epub.ready
            if (cancelled) return
            try {
              await epub.loaded.pageList
            } catch {
              /* 多数 EPUB 无 page-list */
            }
            const cached = loadCachedEpubLocations(bookId)
            if (cached) {
              epub.locations.load(cached)
            } else {
              setPagesBuilding(true)
              ;(epub.locations as unknown as { pause: number }).pause = 1
              await epub.locations.generate(EPUB_LOC_CHARS)
              if (cancelled) return
              if (epub.locations.length() > 0) {
                saveCachedEpubLocations(bookId, epub.locations.save())
              }
            }
            if (cancelled) return
            const cur = rendition.currentLocation() as unknown as { start?: { cfi: string; percentage?: number } }
            syncPageFromCfi(cur?.start?.cfi, cur?.start?.percentage || 0)
          } catch (err) {
            console.warn('EPUB 页码索引生成失败', err)
          } finally {
            if (!cancelled) setPagesBuilding(false)
          }
        }
        void bootLocations()

        rendition.on(
          'relocated',
          (location: {
            start: { href: string; percentage: number; cfi: string; displayed?: { page: number; total: number } }
          }) => {
            currentHrefRef.current = location.start.href
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
            const pctForSave = readPercentage(location.start.cfi, location.start.percentage)
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveTimerRef.current = setTimeout(() => {
              api
                .put(`/api/books/${bookId}/progress`, {
                  location: location.start.cfi,
                  percent: pctForSave,
                })
                .catch(() => {})
            }, 800)
          },
        )

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
            const pointer = pointerClient
              ? pointerToViewport(pointerClient.x, pointerClient.y, wrapRect || undefined)
              : null
            return withPointer(base, pointer)
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
        const presentSelectionFromContents = (
          contents: ContentsLike,
          cfiHint?: string,
          force = false,
          pointerClient?: { x: number; y: number } | null,
        ) => {
          // 划词未结束：不弹气泡，避免挡继续拖选
          if (!force && selectingRef.current) return false
          const sel = contents.window.getSelection()
          const text = sel?.toString().trim() || ''
          if (!text || !sel || sel.rangeCount === 0) return false
          if (!force && !isIntentionalTextSelection(text, pointerMovePxRef.current)) {
            clearDomSelection(contents.window)
            return false
          }
          // 与 mouseup/selected 去重
          if (!force && Date.now() - lastPresentAt < 50 && selectionRef.current?.text === text) {
            return true
          }
          let cfiRange = cfiHint || ''
          let anchor: SelectionAnchor | null = null
          try {
            const range = sel.getRangeAt(0)
            if (!cfiRange) {
              try {
                cfiRange = contents.cfiFromRange(range) || ''
              } catch {
                cfiRange = ''
              }
            }
            // 桌面贴选区末端/指针右下；移动端贴底（anchor=null → fallback）
            if (!isCompactRef.current) {
              const ptr = pointerClient ?? lastPointerClientRef.current
              anchor = resolveSelectionAnchor(range, contents, ptr)
            }
          } catch {
            anchor = null
          }
          setActiveHighlight(null)
          if (pageSourceRef.current !== 'virtual' && currentPageRef.current > 0) {
            setBasketPage(String(currentPageRef.current))
          } else {
            setBasketPage('')
          }
          const nextSel = { cfiRange: cfiRange || `mobile-${Date.now()}`, text, anchor }
          // 同步写入 ref，避免紧随其后的 click 因 state 未提交而误关气泡
          selectionRef.current = nextSel
          lastPresentAt = Date.now()
          setSelection(nextSel)
          return true
        }

        rendition.on(
          'selected',
          (cfiRange: string, contents: ContentsLike) => {
            // 拖选过程中 epub.js 也会触发 selected；等 pointerup 再出
            if (selectingRef.current) return
            presentSelectionFromContents(contents, cfiRange)
          },
        )

        // 右键 / 触摸选区 / 脚注内链 / iframe 内点按
        rendition.hooks.content.register((contents: ContentsLike) => {
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
          const dismissOpenBubble = () => {
            if (!selectionRef.current) return
            selectionRef.current = null
            setSelection(null)
            setBasketPage('')
          }
          const onPointerDownTrack = (e: PointerEvent) => {
            selectingRef.current = true
            pointerStartRef.current = { x: e.clientX, y: e.clientY }
            lastPointerClientRef.current = { x: e.clientX, y: e.clientY }
            pointerMovePxRef.current = 0
            // 新一轮划词：先收起旧气泡，避免挡选
            if (!bubbleInteractingRef.current) dismissOpenBubble()
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
          const onSelectionChange = () => {
            const text = selectionText(contents.window)
            if (text) {
              if (clearTimer) {
                clearTimeout(clearTimer)
                clearTimer = null
              }
              // 桌面：划词中不弹，等 pointerup；移动端手柄拖动后防抖刷新
              if (!isCompactRef.current) return
              if (selectingRef.current) return
              if (showTimer) clearTimeout(showTimer)
              showTimer = setTimeout(() => {
                showTimer = null
                presentSelectionFromContents(contents)
              }, 320)
              return
            }
            if (showTimer) {
              clearTimeout(showTimer)
              showTimer = null
            }
            // 刚弹出气泡的短时间内，忽略选区被清空（mouseup/click 常会清掉）
            if (Date.now() - lastPresentAt < 600) return
            // 移动端：选区被系统清掉后仍保留气泡
            if (isCompactRef.current) return
            if (!selectionRef.current) return
            if (clearTimer) clearTimeout(clearTimer)
            clearTimer = setTimeout(() => {
              clearTimer = null
              if (Date.now() - lastPresentAt < 600) return
              if (bubbleInteractingRef.current) return
              if (selectionText(contents.window)) return
              if (document.querySelector('.selection-menu:hover, .selection-menu:focus-within')) return
              if (document.activeElement?.closest?.('.selection-menu')) return
              if (selectionRef.current) {
                selectionRef.current = null
                setSelection(null)
                setBasketPage('')
              }
            }, 280)
          }
          const onPointerUpSelect = (e: PointerEvent) => {
            // touch 走 touchend（给系统选区手柄一点 settle 时间）
            if (e.pointerType === 'touch') return
            // 鼠标必须同步弹出：延迟会被随后的 click 抢先清掉选区
            finishSelect(0, { x: e.clientX, y: e.clientY })
          }
          const onPointerCancelSelect = (e: PointerEvent) => {
            finishSelect(0, { x: e.clientX, y: e.clientY })
          }
          const onTouchEndSelect = (e: TouchEvent) => {
            const t = e.changedTouches?.[0]
            finishSelect(isCompactRef.current ? 200 : 40, t ? { x: t.clientX, y: t.clientY } : null)
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

          let iframeTouchX = 0
          let iframeTouchY = 0
          let iframeTouchAt = 0
          const onIframeTouchStart = (e: TouchEvent) => {
            const t = e.touches?.[0]
            if (!t) return
            iframeTouchX = t.clientX
            iframeTouchY = t.clientY
            iframeTouchAt = Date.now()
            pointerStartRef.current = { x: t.clientX, y: t.clientY }
            pointerMovePxRef.current = 0
          }
          const onIframeTouchMove = (e: TouchEvent) => {
            const t = e.touches?.[0]
            if (!t || !pointerStartRef.current) return
            pointerMovePxRef.current = Math.max(
              pointerMovePxRef.current,
              pointerTravel(pointerStartRef.current, t.clientX, t.clientY),
            )
          }
          const onIframeTouchEndNav = (e: TouchEvent) => {
            // 左右翻页主要由外层热区承担；iframe 内仅中央点按切换工具栏
            if (Date.now() - lastPresentAt < 500) return
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
            // 落在左右翻页带：交给外层热区（避免点按选字）
            if (xRatio < 0.18 || xRatio > 0.82) return
            if (isCompactRef.current) toggleChromeRef.current()
          }

          contents.document.addEventListener('contextmenu', onContextMenu)
          contents.document.addEventListener('selectionchange', onSelectionChange)
          contents.document.addEventListener('pointerdown', onPointerDownTrack, { passive: true })
          contents.document.addEventListener('pointermove', onPointerMoveTrack, { passive: true })
          contents.document.addEventListener('pointerup', onPointerUpSelect, { passive: true })
          contents.document.addEventListener('pointercancel', onPointerCancelSelect, { passive: true })
          contents.document.addEventListener('touchend', onTouchEndSelect, { passive: true })
          contents.document.addEventListener('click', onLinkClickCapture, true)
          contents.document.addEventListener('touchstart', onIframeTouchStart, { passive: true })
          contents.document.addEventListener('touchmove', onIframeTouchMove, { passive: true })
          contents.document.addEventListener('touchend', onIframeTouchEndNav, { passive: true })
        })

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
        const turnPrev = () => {
          clearEpubSelections()
          rendition.prev()
        }
        const turnNext = () => {
          clearEpubSelections()
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

        let lastTouchNavAt = 0
        const markTouchNav = () => {
          lastTouchNavAt = Date.now()
        }

        clickHandler = (event: MouseEvent, contents: { window: Window }) => {
          // 划词结束后的合成 click：绝不能关掉刚弹出的气泡 / 清掉选区
          if (Date.now() - lastPresentAt < 800) return
          if (Date.now() - lastTouchNavAt < 450) return
          const target = event.target as HTMLElement | null
          if (target && target.closest('a, button, input, textarea, select')) return
          const win = contents?.window
          const accidental = selectionText(win)
          if (accidental && !isIntentionalTextSelection(accidental, pointerMovePxRef.current)) {
            clearDomSelection(win)
          } else if (accidental) {
            return
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

        // 滑屏翻页（点按主要靠透明热区，避免依赖 iframe 事件）
        let touchStartX = 0
        let touchStartY = 0
        let touchHandled = false
        const SWIPE_THRESHOLD = 40
        touchStartHandler = (e: TouchEvent) => {
          const t = e.touches?.[0] || e.changedTouches?.[0]
          if (!t) return
          touchStartX = t.clientX
          touchStartY = t.clientY
          touchHandled = false
        }
        touchEndHandler = (e: TouchEvent) => {
          if (touchHandled) return
          try {
            const rawContents = rendition.getContents?.() as unknown
            const list: ContentsLike[] = Array.isArray(rawContents)
              ? rawContents
              : rawContents
                ? [rawContents as ContentsLike]
                : []
            for (const c of list) {
              if (c.window?.getSelection?.()?.toString().trim()) {
                presentSelectionFromContents(c)
                touchHandled = true
                return
              }
            }
          } catch {
            /* ignore */
          }
          if (selectionRef.current) return
          const t = e.changedTouches?.[0]
          if (!t) return
          const dx = t.clientX - touchStartX
          const dy = t.clientY - touchStartY
          const absDx = Math.abs(dx)
          const absDy = Math.abs(dy)

          if (absDy > SWIPE_THRESHOLD && absDy > absDx * 1.15) {
            touchHandled = true
            markTouchNav()
            if (dy < 0) turnNext()
            else turnPrev()
            return
          }
          if (absDx > SWIPE_THRESHOLD && absDx > absDy * 1.15) {
            touchHandled = true
            markTouchNav()
            if (dx < 0) turnNext()
            else turnPrev()
          }
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

  // 深链 ?cfi=（含搜索命中）：书内切换时压「返回原处」；有 q 时再短暂高亮
  useEffect(() => {
    if (loading) return
    const cfi = (searchParams.get('cfi') || '').trim()
    const q = (searchParams.get('q') || '').trim()
    if (!cfi || !renditionRef.current) return
    const key = `${bookId}@@${cfi}@@${q}`
    if (lastFlashKeyRef.current === key) return
    lastFlashKeyRef.current = key
    let cancelled = false
    ;(async () => {
      try {
        const prior = currentCfiRef.current
        if (prior && prior !== cfi) pushNavBackPoint()
        await renditionRef.current?.display(cfi)
        if (!renditionRef.current) return
        await waitRenditionRendered(renditionRef.current)
        if (cancelled || !q) return
        const n = await flashSearchKeywordRef.current(q, { refineToKeyword: true, durationMs: 4000 })
        if (!cancelled && n === 0) toast.message('已跳转，未在当前页找到可高亮的匹配')
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
      rendition.themes.default({
        '::selection': { background: 'rgba(216,169,78,0.35)' },
        body: {
          'font-family': "'Noto Serif SC', serif !important",
          background: `${colors.bg} !important`,
          color: `${colors.fg} !important`,
          '-webkit-user-select': 'text !important',
          'user-select': 'text !important',
        },
      })
      // themes.default 后重新施加字号，避免被主题覆盖后看起来「没反应」
      rendition.themes.fontSize(`${fontSizeRef.current}%`)
    }
    if (viewerRef.current) viewerRef.current.style.background = colors.bg
  }

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

  function changeFontSize(delta: number) {
    const next = Math.min(180, Math.max(70, fontSizeRef.current + delta))
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
    lastPointerClientRef.current = null
    pointerStartRef.current = null
    pointerMovePxRef.current = 0
  }

  function handleTapZone(action: 'prev' | 'next') {
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

  function searchSelectionInBook() {
    if (!selection?.text) return
    const q = selection.text.slice(0, 80)
    setSearchQuery(q)
    setDrawerTab('search')
    dismissSelection()
    window.setTimeout(() => {
      void (async () => {
        if (!bookId || !q.trim()) return
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
      })()
    }, 0)
  }

  async function addToBasket() {
    if (!selection) return
    let projectId = basketProjectId || projects[0]?.id
    if (!projectId) {
      try {
        const created = await api.post<{ id: string; name: string }>('/api/citation/projects', {
          name: '默认引用篮',
        })
        projectId = created.id
        setProjects((prev) => [{ id: created.id, name: created.name, script_variant: 'simplified', created_at: '' }, ...prev])
        setBasketProjectId(created.id)
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '无法创建引用篮项目')
        return
      }
    }
    try {
      const pageNo = basketPage.trim()
      await api.post('/api/citation/items', {
        project_id: projectId,
        book_id: bookId,
        quoted_text: selection.text,
        page_no: pageNo,
      })
      if (!pageNo) {
        toast.success('已加入引用篮（未填页码，导出前请补纸书页）')
      } else if (pageSourceRef.current === 'estimate') {
        toast.success('已加入引用篮（页码为估算，请按纸书核对）')
      } else if (pageSourceRef.current === 'virtual') {
        toast.success('已加入引用篮（当前为虚拟页，请改成纸书页码）')
      } else {
        toast.success('已加入引用篮')
      }
      dismissSelection()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '存入失败')
    }
  }

  async function copyQuickFootnote() {
    try {
      const pageNo = basketPage.trim()
      const params = new URLSearchParams({ book_id: bookId })
      if (pageNo) params.set('page_no', pageNo)
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
      toast.success(pageNo ? '脚注已复制' : '脚注已复制（未填页码）')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '复制脚注失败')
    }
  }

  function dismissSelection() {
    selectionRef.current = null
    setSelection(null)
    setBasketPage('')
  }

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
          <button className="icon-btn" onClick={() => navigate(-1)} title="返回" aria-label="返回">
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
          <button
            className={`icon-btn ${showThemePicker ? 'active' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setShowThemePicker((v) => !v)
              setDrawerTab(null)
            }}
            title="显示设置（字号 / 背景）"
          >
            <Palette size={18} />
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
        </div>
      )}

      <ReaderReturnOriginBar visible={canNavBack} onReturn={goNavBack} onDismiss={dismissNavOrigin} />

      <div className="reader-body">
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

          {!loading && (
            <>
              {/* 左右热区盖在 iframe 之上：点按翻页且不触发选字 */}
              <div
                className="reader-tap-zone left"
                aria-hidden
                onPointerDown={suppressTapZonePointer}
                onMouseDown={suppressTapZonePointer}
                onClick={(e) => {
                  e.stopPropagation()
                  handleTapZone('prev')
                }}
              />
              <div
                className="reader-tap-zone right"
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

          {selection && (
            <SelectionBubble
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
              onQuickFootnote={() => void copyQuickFootnote()}
              onSearchInBook={searchSelectionInBook}
              onDismiss={dismissSelection}
              containerWidth={viewerWrapRef.current?.clientWidth || 360}
              containerHeight={viewerWrapRef.current?.clientHeight || 640}
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
                {flattenToc(toc).map(({ item, depth }) => (
                  <button
                    key={item.id + item.href}
                    type="button"
                    className="reader-toc-item"
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
                ))}
                {toc.length === 0 && <div className="empty-state">该书暂无目录信息</div>}
              </div>
            )}

            {drawerTab === 'notes' && (
              <div>
                {highlights.length === 0 && <div className="empty-state">还没有高亮或笔记，选中正文文字即可创建</div>}
                {highlights.map((h) => (
                  <div key={h.id} className="highlight-item" onClick={() => void jumpTo(h.cfi_range)}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
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
                      <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--accent-strong)' }}>笔记：{h.note}</div>
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
                        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{r.chapter_title}</div>
                        <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                          <HighlightedText text={r.snippet} query={searchHighlightQuery} />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

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
      </div>
    </div>
  )
}

function resolveReaderTheme(themeId: string, customBg: string): { bg: string; fg: string } {
  if (themeId === 'custom') {
    // 自定义背景色时，按亮度自动选择黑/白文字，保证可读性
    const hex = customBg.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16) || 0
    const g = parseInt(hex.substring(2, 4), 16) || 0
    const b = parseInt(hex.substring(4, 6), 16) || 0
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return { bg: customBg, fg: luminance > 0.5 ? '#2b2620' : '#e8e3d8' }
  }
  const preset = READER_THEMES.find((t) => t.id === themeId)
  return preset ? { bg: preset.bg, fg: preset.fg } : { bg: '#f4ecd8', fg: '#2b2620' }
}

function findChapterTitle(toc: NavItem[], href: string): string {
  const flat = flattenToc(toc)
  const cleanHref = href.split('#')[0]
  const match = flat.find((f) => f.item.href.split('#')[0] === cleanHref)
  return match?.item.label?.trim() || ''
}
