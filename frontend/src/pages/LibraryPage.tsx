import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  FolderPlus,
  GripVertical,
  LayoutGrid,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Tags,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { BookSummary, BrowseResult, Library, Tag } from '../api/types'
import AnimatedNumber from '../components/AnimatedNumber'
import BookCard from '../components/BookCard'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import MotionGrid from '../components/MotionGrid'
import { useAuth } from '../contexts/AuthContext'
import { trackGlow } from '../lib/glowTrack'
import { useRowCapacity } from '../lib/useRowCapacity'

interface Stats {
  total_books: number
  finished: number
  reading: number
  finished_this_month: number
  total_highlights: number
  total_citations: number
  missing_douban?: number
  favorites?: number
  top_rated?: number
}

type GroupMode = 'shelf' | 'tag' | 'flat'
type SortMode = 'added_desc' | 'added_asc' | 'rating_desc' | 'title'

const SORT_KEY = 'moyin_library_sort'

function loadSort(): SortMode {
  try {
    const v = localStorage.getItem(SORT_KEY)
    if (v === 'added_desc' || v === 'added_asc' || v === 'rating_desc' || v === 'title') return v
  } catch {
    /* private mode */
  }
  return 'added_desc'
}

interface BookSection {
  key: string
  title: string
  hint?: string
  books: BookSummary[]
}

const GROUP_MODE_KEY = 'moyin_library_group_mode'
const COLLAPSED_KEY = 'moyin_library_collapsed'
const BATCH_SELECT_KEY = 'moyin_batch_select_missing'
/** 单次批量重新匹配上限（与后端一致） */
const BATCH_REMATCH_LIMIT = 200

type BatchPhase = 'running' | 'stopping' | 'done' | 'stopped'
type BatchKind = 'rematch' | 'delete'

interface BatchProgressJob {
  kind: BatchKind
  phase: BatchPhase
  total: number
  success: number
  failed: number
  currentTitle: string
  /** 尚未处理完的 id（含当前正在处理的） */
  remainingIds: string[]
  /** 失败的 id，结束后保留勾选 */
  failedIds: string[]
}

function loadBatchSelection(): Set<string> {
  try {
    const raw = sessionStorage.getItem(BATCH_SELECT_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

function saveBatchSelection(ids: Set<string>) {
  try {
    sessionStorage.setItem(BATCH_SELECT_KEY, JSON.stringify([...ids]))
  } catch {
    /* private mode */
  }
}

function clearBatchSelectionStorage() {
  try {
    sessionStorage.removeItem(BATCH_SELECT_KEY)
  } catch {
    /* private mode */
  }
}

function loadGroupMode(): GroupMode {
  try {
    const v = localStorage.getItem(GROUP_MODE_KEY)
    if (v === 'shelf' || v === 'tag' || v === 'flat') return v
  } catch {
    /* private mode */
  }
  return 'shelf'
}

/**
 * 书库页每次切换过来都要经历「空白 → 转圈 → 内容」，观感上像是「刷新了一下」——
 * 因为路由切换会把 LibraryPage 整个卸载重挂载，组件内 state 全部归零，
 * 再重新发一轮请求。这里用一个模块级缓存（随 JS 模块常驻，不随组件卸载丢失）
 * 保存上一次成功拿到的数据，下次挂载时先用缓存直接把内容摆出来，
 * 同时在背后静默刷新一次，体验上跟首页等常驻数据的页面一致。
 */
let libraryCache: { books: BookSummary[]; tags: Tag[]; libraries: Library[]; stats: Stats | null } | null = null

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export default function LibraryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [books, setBooks] = useState<BookSummary[]>(() => libraryCache?.books ?? [])
  const [tags, setTags] = useState<Tag[]>(() => libraryCache?.tags ?? [])
  const [libraries, setLibraries] = useState<Library[]>(() => libraryCache?.libraries ?? [])
  const [stats, setStats] = useState<Stats | null>(() => libraryCache?.stats ?? null)
  const [q, setQ] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeLibrary, setActiveLibrary] = useState<string | null>(null)
  const [status, setStatus] = useState(() => searchParams.get('status') || '')
  const metaFilter = searchParams.get('meta') || ''
  // 有缓存的话直接展示缓存内容，不再从「转圈」状态开始
  const [loading, setLoading] = useState(() => libraryCache === null)
  const isFirstRunRef = useRef(true)
  const [showLibraryModal, setShowLibraryModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadLibraryId, setUploadLibraryId] = useState<string>('__none__')
  const [uploading, setUploading] = useState(false)
  const [scanningAll, setScanningAll] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [stoppingScan, setStoppingScan] = useState(false)
  const [groupMode, setGroupMode] = useState<GroupMode>(loadGroupMode)
  const [sortMode, setSortMode] = useState<SortMode>(loadSort)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    searchParams.get('meta') === 'missing_douban' ? loadBatchSelection() : new Set(),
  )
  const [showBatchDelete, setShowBatchDelete] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const softWatchTimerRef = useRef<number | null>(null)
  const batchStopRef = useRef(false)
  const [batchJob, setBatchJob] = useState<BatchProgressJob | null>(null)
  const canBatchActions = user?.role === 'admin' && metaFilter === 'missing_douban'
  const canBatchDelete = canBatchActions
  const batchBusy = Boolean(batchJob && (batchJob.phase === 'running' || batchJob.phase === 'stopping'))
  const batchRematching = Boolean(batchBusy && batchJob?.kind === 'rematch')
  const batchDeleting = Boolean(batchBusy && batchJob?.kind === 'delete')

  async function refresh(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (activeTag) params.set('tag', activeTag)
      if (status) params.set('status', status)
      if (metaFilter) params.set('meta', metaFilter)
      params.set('sort', sortMode)
      const [b, t] = await Promise.all([
        api.get<BookSummary[]>(`/api/books?${params.toString()}`),
        api.get<Tag[]>('/api/tags'),
      ])
      const sortedTags = t.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      setBooks(b)
      setTags(sortedTags)
      // 只在「无筛选的默认视图」下写入缓存，避免下次进页面直接展示某次筛选后的结果
      if (!q && !activeTag && !status && !metaFilter) {
        libraryCache = { books: b, tags: sortedTags, libraries: libraryCache?.libraries ?? [], stats: libraryCache?.stats ?? null }
      }
    } catch (err) {
      if (!opts?.silent) toast.error(err instanceof ApiError ? err.message : '加载书库失败')
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }

  function clearSoftWatch() {
    if (softWatchTimerRef.current != null) {
      window.clearInterval(softWatchTimerRef.current)
      softWatchTimerRef.current = null
    }
  }

  /** 后台轻量轮询：以 scan/status 为准，扫完或停止后静默刷新 */
  function softWatchScan() {
    clearSoftWatch()
    let tries = 0
    softWatchTimerRef.current = window.setInterval(async () => {
      tries += 1
      try {
        const status = await api.get<{ busy: boolean }>('/api/libraries/scan/status')
        const libs = await api.get<Library[]>('/api/libraries')
        setLibraries(libs.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)))
        setScanBusy(Boolean(status.busy))
        if (!status.busy || tries >= 180) {
          clearSoftWatch()
          setScanBusy(false)
          await refresh({ silent: true })
          api.get<Stats>('/api/admin/stats').then(setStats).catch(() => {})
          if (!status.busy && tries > 1) toast.success('书库扫描已结束')
        }
      } catch {
        if (tries >= 180) clearSoftWatch()
      }
    }, 2000)
  }

  async function scanAllLibraries() {
    if (scanningAll) return
    setScanningAll(true)
    try {
      const libs = await api.get<Library[]>('/api/libraries')
      setLibraries(libs.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)))
      if (libs.length === 0) {
        toast.error('还没有书库目录，请先添加')
        return
      }
      await api.post('/api/libraries/scan-all')
      setScanBusy(true)
      toast.success('已排队后台扫描，可继续浏览；需要时可点「停止扫描」')
      softWatchScan()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '扫描失败')
    } finally {
      setScanningAll(false)
    }
  }

  async function stopScan() {
    if (stoppingScan) return
    setStoppingScan(true)
    try {
      await api.post('/api/libraries/scan/stop')
      clearSoftWatch()
      setScanBusy(false)
      toast.success('已请求停止扫描（排队已清空；当前文件处理完即停）')
      await refresh({ silent: true })
      api.get<Library[]>('/api/libraries').then(libs => setLibraries(libs.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)))).catch(() => {})
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '停止失败')
    } finally {
      setStoppingScan(false)
    }
  }

  function setMetaFilter(next: string) {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('meta', next)
    else params.delete('meta')
    const qs = params.toString()
    navigate(qs ? `/library?${qs}` : '/library', { replace: true })
    if (next === 'missing_douban') {
      setSelectedIds(loadBatchSelection())
    } else {
      clearBatchSelectionStorage()
      setSelectedIds(new Set())
    }
    if (next === 'missing_douban' || next === 'favorited') {
      setActiveLibrary(null)
      setActiveTag(null)
      setStatus('')
      setQ('')
    }
  }

  function toggleSelect(bookId: string) {
    if (batchBusy) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(bookId)) next.delete(bookId)
      else next.add(bookId)
      return next
    })
  }

  function selectAllMissing() {
    if (batchBusy) return
    setSelectedIds(new Set(filteredBooks.map((b) => b.id)))
  }

  function clearSelection() {
    if (batchBusy) return
    setSelectedIds(new Set())
    clearBatchSelectionStorage()
  }

  function closeBatchModal() {
    if (batchBusy) return
    setBatchJob(null)
  }

  function stopBatchJob() {
    if (!batchJob || batchJob.phase !== 'running') return
    batchStopRef.current = true
    setBatchJob((prev) => (prev ? { ...prev, phase: 'stopping' } : prev))
  }

  function orderedSelectedIds() {
    const ordered = filteredBooks.map((b) => b.id).filter((id) => selectedIds.has(id))
    const inList = new Set(ordered)
    for (const id of selectedIds) {
      if (!inList.has(id)) ordered.push(id)
    }
    return ordered
  }

  async function batchDeleteSelected() {
    if (!selectedIds.size || batchBusy) return
    const ids = orderedSelectedIds()
    if (!ids.length) return

    const titleById = new Map(filteredBooks.map((b) => [b.id, b.title]))
    setShowBatchDelete(false)
    batchStopRef.current = false
    setBatchJob({
      kind: 'delete',
      phase: 'running',
      total: ids.length,
      success: 0,
      failed: 0,
      currentTitle: titleById.get(ids[0]) || '',
      remainingIds: [...ids],
      failedIds: [],
    })

    let success = 0
    let failed = 0
    const failedIds: string[] = []
    const skippedIds: string[] = []

    for (let i = 0; i < ids.length; i++) {
      if (batchStopRef.current) {
        skippedIds.push(...ids.slice(i))
        break
      }
      const id = ids[i]
      const title = titleById.get(id) || ''
      setBatchJob((prev) =>
        prev
          ? {
              ...prev,
              phase: batchStopRef.current ? 'stopping' : 'running',
              currentTitle: title,
              remainingIds: ids.slice(i),
              success,
              failed,
              failedIds: [...failedIds],
            }
          : prev,
      )

      try {
        await api.delete(`/api/books/${id}`)
        success += 1
        setBooks((prev) => prev.filter((b) => b.id !== id))
        setSelectedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } catch {
        failed += 1
        failedIds.push(id)
      }
    }

    const stopped = batchStopRef.current
    const keepIds = [...failedIds, ...skippedIds]
    setSelectedIds(new Set(keepIds))
    if (keepIds.length === 0) clearBatchSelectionStorage()

    setBatchJob({
      kind: 'delete',
      phase: stopped ? 'stopped' : 'done',
      total: ids.length,
      success,
      failed,
      currentTitle: '',
      remainingIds: skippedIds,
      failedIds,
    })

    await refresh({ silent: true })
    api.get<Stats>('/api/admin/stats').then(setStats).catch(() => {})
  }

  async function batchRematchSelected() {
    if (!selectedIds.size || batchBusy) return
    let ids = orderedSelectedIds()
    if (ids.length > BATCH_REMATCH_LIMIT) {
      ids = ids.slice(0, BATCH_REMATCH_LIMIT)
      setSelectedIds(new Set(ids))
      toast.warning(
        `单次最多匹配 ${BATCH_REMATCH_LIMIT} 本，已保留列表前 ${BATCH_REMATCH_LIMIT} 本并取消其余勾选`,
      )
    }
    if (!ids.length) return

    const titleById = new Map(filteredBooks.map((b) => [b.id, b.title]))
    batchStopRef.current = false
    setBatchJob({
      kind: 'rematch',
      phase: 'running',
      total: ids.length,
      success: 0,
      failed: 0,
      currentTitle: titleById.get(ids[0]) || '',
      remainingIds: [...ids],
      failedIds: [],
    })

    let success = 0
    let failed = 0
    const failedIds: string[] = []
    const skippedIds: string[] = []

    for (let i = 0; i < ids.length; i++) {
      if (batchStopRef.current) {
        skippedIds.push(...ids.slice(i))
        break
      }
      const id = ids[i]
      const title = titleById.get(id) || ''
      setBatchJob((prev) =>
        prev
          ? {
              ...prev,
              phase: batchStopRef.current ? 'stopping' : 'running',
              currentTitle: title,
              remainingIds: ids.slice(i),
              success,
              failed,
              failedIds: [...failedIds],
            }
          : prev,
      )

      try {
        const res = await api.post<{
          matched: boolean
          title?: string
          error?: string
          risk_control?: boolean
        }>(`/api/books/${id}/rematch`)
        if (res.matched) success += 1
        else {
          failed += 1
          failedIds.push(id)
          if (res.risk_control || (res.error && res.error.includes('风控'))) {
            batchStopRef.current = true
            toast.warning(res.error || '豆瓣触发风控，已停止后续匹配。请更新 Cookie 后重试。')
            skippedIds.push(...ids.slice(i + 1))
            break
          }
        }
      } catch {
        failed += 1
        failedIds.push(id)
      }
    }

    const stopped = batchStopRef.current
    const keepIds = [...failedIds, ...skippedIds]
    setSelectedIds(new Set(keepIds))
    if (keepIds.length === 0) clearBatchSelectionStorage()

    setBatchJob({
      kind: 'rematch',
      phase: stopped ? 'stopped' : 'done',
      total: ids.length,
      success,
      failed,
      currentTitle: '',
      remainingIds: skippedIds,
      failedIds,
    })

    await refresh({ silent: true })
    api.get<Stats>('/api/admin/stats').then(setStats).catch(() => {})
  }

  function onFavoriteChange(bookId: string, isFavorite: boolean) {
    setBooks((prev) => {
      const next = prev.map((b) => (b.id === bookId ? { ...b, is_favorite: isFavorite } : b))
      if (metaFilter === 'favorited' && !isFavorite) {
        return next.filter((b) => b.id !== bookId)
      }
      return next
    })
    setStats((prev) =>
      prev
        ? {
            ...prev,
            favorites: Math.max(0, (prev.favorites ?? 0) + (isFavorite ? 1 : -1)),
          }
        : prev,
    )
  }

  useEffect(() => {
    // 只有「首次挂载 + 已经有缓存可以先展示」时才静默刷新；
    // 用户在页面里主动切筛选/排序，还是应该走原来的转圈反馈，不受缓存影响
    const silent = isFirstRunRef.current && libraryCache !== null
    isFirstRunRef.current = false
    refresh({ silent })
    api.get<Stats>('/api/admin/stats').then((s) => {
      setStats(s)
      if (libraryCache) libraryCache.stats = s
    }).catch(() => {})
    api.get<Library[]>('/api/libraries').then(libs => {
      const sorted = libs.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      setLibraries(sorted)
      if (libraryCache) libraryCache.libraries = sorted
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activeTag, status, metaFilter, sortMode])

  // 移动端不提供标签筛选；若仍停留在「按标签」视图则退回书架
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const sync = () => {
      if (!mq.matches) return
      if (activeTag) setActiveTag(null)
      if (groupMode === 'tag') setGroupMode('shelf')
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [activeTag, groupMode])

  useEffect(() => {
    if (metaFilter === 'missing_douban') saveBatchSelection(selectedIds)
  }, [selectedIds, metaFilter])

  useEffect(() => {
    if (user?.role !== 'admin') return
    let cancelled = false
    async function poll() {
      try {
        const status = await api.get<{ busy: boolean }>('/api/libraries/scan/status')
        if (!cancelled) setScanBusy(Boolean(status.busy))
      } catch {
        /* ignore */
      }
    }
    void poll()
    const timer = window.setInterval(poll, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [user?.role])

  useEffect(() => () => clearSoftWatch(), [])

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_MODE_KEY, groupMode)
    } catch {
      /* private mode */
    }
  }, [groupMode])

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, sortMode)
    } catch {
      /* private mode */
    }
  }, [sortMode])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed))
    } catch {
      /* private mode */
    }
  }, [collapsed])

  const filteredBooks = useMemo(() => {
    if (!activeLibrary) return books
    if (activeLibrary === '__none__') return books.filter((b) => !b.library_id)
    return books.filter((b) => b.library_id === activeLibrary)
  }, [books, activeLibrary])

  const sections = useMemo(() => {
    return buildBookSections(filteredBooks, groupMode, libraries, tags)
  }, [filteredBooks, groupMode, libraries, tags])

  const emptyHint = useMemo(() => {
    if (loading) return null
    if (filteredBooks.length > 0) return null
    if (metaFilter === 'favorited') return '还没有收藏的书，点封面右上角星星收藏'
    if (metaFilter === 'missing_douban') return '没有缺少信息的书籍'
    return q || activeTag || status || activeLibrary ? '没有匹配的书籍' : '书库还是空的，上传第一本电子书开始吧'
  }, [loading, filteredBooks, q, activeTag, status, activeLibrary, metaFilter])

  const effectiveGroupMode: GroupMode =
    metaFilter === 'missing_douban' || metaFilter === 'favorited' ? 'flat' : groupMode

  // 高分推荐：书籍内容区首行，有豆瓣评分的书按评分从高到低排列（不限阅读状态），
  // 只在「纯浏览」场景（无搜索/筛选）展示，行内数量随容器宽度自适应
  const [recommendedCapacity, recommendedRowRef] = useRowCapacity({ minItemWidth: 158, gap: 22, min: 3, max: 16 })
  const recommendedBooks = useMemo(() => {
    return books
      .filter((b) => (b.rating || 0) > 0)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
  }, [books])
  const showRecommended =
    !loading && !metaFilter && !q && !activeTag && !activeLibrary && !status && recommendedBooks.length > 0
  const visibleRecommended = recommendedBooks.slice(0, recommendedCapacity)

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <>
      <div className="topbar library-topbar">
        <div className="library-topbar-heading">
          <div className="page-title text-gradient-accent">我的书库</div>
          <div className="page-subtitle">按书架与标签浏览 · 标注 · 沉淀写作引用</div>
        </div>
        <div className="library-topbar-actions">
          {user?.role === 'admin' && (
            <>
              <button className="btn" onClick={scanAllLibraries} disabled={scanningAll || scanBusy} title="扫描全部书库目录并同步增删">
                <RefreshCw size={16} className={scanningAll || scanBusy ? 'spin' : undefined} />
                <span className="btn-label-full">{scanningAll || scanBusy ? '扫描中…' : '扫描书库'}</span>
                <span className="btn-label-short">{scanningAll || scanBusy ? '扫描中' : '扫描'}</span>
              </button>
              {(scanBusy || stoppingScan) && (
                <button
                  className="btn btn-danger"
                  onClick={stopScan}
                  disabled={stoppingScan}
                  title="立刻清空排队并中止当前扫描，避免大库继续入库"
                >
                  <span className="btn-label-full">{stoppingScan ? '停止中…' : '停止扫描'}</span>
                  <span className="btn-label-short">{stoppingScan ? '停止中' : '停止'}</span>
                </button>
              )}
              <button className="btn" onClick={() => setShowLibraryModal(true)} title="管理书库目录">
                <FolderPlus size={16} />
                <span className="btn-label-full">管理书库目录</span>
                <span className="btn-label-short">目录</span>
              </button>
            </>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              setUploadFile(null)
              setUploadLibraryId(
                activeLibrary && activeLibrary !== '__none__' ? activeLibrary : '__none__',
              )
              setShowUploadModal(true)
            }}
            title="上传电子书（入库后全员可见）"
          >
            <UploadCloud size={16} />
            <span className="btn-label-full">上传电子书</span>
            <span className="btn-label-short">上传</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept=".epub,.pdf,.mobi,.azw3,.azw,.fb2,.txt,.cbz,.cbr"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) setUploadFile(file)
            }}
          />
        </div>
      </div>

      {showUploadModal && (
        <Modal
          title="上传电子书"
          onClose={() => !uploading && setShowUploadModal(false)}
          width={460}
          closeOnBackdrop={!uploading}
        >
          <div className={`upload-modal-body${uploading ? ' is-uploading' : ''}`}>
            <div className="field">
              <label>文件</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  选择文件
                </button>
                <span style={{ fontSize: 13, color: 'var(--ink-dim)', wordBreak: 'break-all' }}>
                  {uploadFile ? uploadFile.name : '尚未选择'}
                </span>
              </div>
            </div>
            <div className="field">
              <label>目标书架</label>
              <select
                className="input"
                value={uploadLibraryId}
                disabled={uploading}
                onChange={(e) => setUploadLibraryId(e.target.value)}
              >
                <option value="__none__">未归架</option>
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.55 }}>
                选择书架后，文件会放入该书架并自动归类；选「未归架」则先不指定书架。
              </div>
            </div>

            {uploading && (
              <div className="upload-progress" role="status" aria-live="polite">
                <div className="upload-progress-icon">
                  <Loader2 size={22} className="spin" />
                </div>
                <div className="upload-progress-text">
                  <div className="upload-progress-title">正在上传并导入…</div>
                  <div className="upload-progress-sub">
                    {uploadFile?.name ? `《${uploadFile.name}》` : '请稍候'}
                    ，大文件或需转换时可能稍慢
                  </div>
                </div>
                <div className="upload-progress-bar" aria-hidden="true">
                  <span className="upload-progress-bar-indeterminate" />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="btn" disabled={uploading} onClick={() => setShowUploadModal(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={uploading || !uploadFile}
                onClick={async () => {
                  if (!uploadFile) return
                  setUploading(true)
                  const formData = new FormData()
                  formData.append('file', uploadFile)
                  if (uploadLibraryId && uploadLibraryId !== '__none__') {
                    formData.append('library_id', uploadLibraryId)
                  }
                  const tId = toast.loading(`正在导入《${uploadFile.name}》…`)
                  try {
                    await api.upload('/api/books/upload', formData)
                    const shelf =
                      uploadLibraryId === '__none__'
                        ? '未归架'
                        : libraries.find((l) => l.id === uploadLibraryId)?.name || '目标书架'
                    toast.success(`导入成功 · ${shelf}`, { id: tId })
                    setShowUploadModal(false)
                    setUploadFile(null)
                    refresh()
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : '导入失败', { id: tId })
                  } finally {
                    setUploading(false)
                  }
                }}
              >
                {uploading ? <Loader2 size={15} className="spin" /> : <UploadCloud size={15} />}
                {uploading ? '上传中…' : '开始上传'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div className="page-content">
        <div className="stat-strip" aria-label="书库概览">
          <span className="stat-strip-item">
            <span className="stat-strip-label">馆藏</span>
            <span className="stat-strip-value">
              <AnimatedNumber value={stats?.total_books} />
            </span>
          </span>
          <span className="stat-strip-item">
            <span className="stat-strip-label">在读</span>
            <span className="stat-strip-value">
              <AnimatedNumber value={stats?.reading} />
            </span>
          </span>
          <span className="stat-strip-item">
            <span className="stat-strip-label">本月读完</span>
            <span className="stat-strip-value">
              <AnimatedNumber value={stats?.finished_this_month} />
            </span>
          </span>
          <span className="stat-strip-item">
            <span className="stat-strip-label">高亮</span>
            <span className="stat-strip-value">
              <AnimatedNumber value={stats?.total_highlights} />
            </span>
          </span>
          <button
            type="button"
            className={`stat-strip-item clickable${metaFilter === 'favorited' ? ' active' : ''}`}
            onClick={() => setMetaFilter(metaFilter === 'favorited' ? '' : 'favorited')}
            title="查看我收藏的书（特别好的 / 待看）"
          >
            <span className="stat-strip-label">收藏</span>
            <span className="stat-strip-value">
              <AnimatedNumber value={stats?.favorites} />
            </span>
          </button>
          <button
            type="button"
            className={`stat-strip-item clickable${metaFilter === 'missing_douban' ? ' active' : ''}`}
            onClick={() => setMetaFilter(metaFilter === 'missing_douban' ? '' : 'missing_douban')}
            title="查看缺少信息的书，点开可手动编辑或匹配豆瓣"
          >
            <span className="stat-strip-label">缺少信息</span>
            <span className="stat-strip-value">
              <AnimatedNumber value={stats?.missing_douban} />
            </span>
          </button>
        </div>

        {metaFilter === 'favorited' && (
          <div className="library-meta-banner">
            <div>
              <strong>我的收藏</strong>
              <span>特别好的书、待看清单；点封面右上角星星可取消</span>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setMetaFilter('')}>
              清除筛选
            </button>
          </div>
        )}

        {metaFilter === 'missing_douban' && (
          <div className="library-meta-banner">
            <div>
              <strong>缺少信息</strong>
              <span>
                {canBatchActions
                  ? '点封面勾选书籍，可批量重新匹配或删除；需要细调时点封面左下角「详情」'
                  : '点封面进入详情，可「匹配豆瓣」或「手动编辑信息」'}
              </span>
            </div>
            <div className="library-meta-banner-actions">
              {canBatchActions && filteredBooks.length > 0 && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={batchBusy}
                    onClick={selectAllMissing}
                  >
                    全选（{filteredBooks.length}）
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={batchBusy}
                      onClick={clearSelection}
                    >
                      取消选择
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!selectedIds.size || batchBusy}
                    onClick={() => void batchRematchSelected()}
                    title="按书名自动匹配豆瓣 / Google 元数据"
                  >
                    {batchRematching ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Wand2 size={14} />
                    )}
                    {batchRematching ? '匹配中…' : `重新匹配（${selectedIds.size}）`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={!selectedIds.size || batchBusy}
                    onClick={() => setShowBatchDelete(true)}
                  >
                    {batchDeleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    {batchDeleting ? '删除中…' : `删除所选（${selectedIds.size}）`}
                  </button>
                </>
              )}
              <button type="button" className="btn btn-sm" disabled={batchBusy} onClick={() => setMetaFilter('')}>
                清除筛选
              </button>
            </div>
          </div>
        )}

        <div className="toolbar library-toolbar">
          <div className="search-box" onMouseMove={trackGlow}>
            <Search size={16} />
            <input className="input" placeholder="按书名 / 作者 / ISBN 搜索…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            <option value="unread">未读</option>
            <option value="reading">在读</option>
            <option value="finished">已读完</option>
          </select>
          <select
            className="input"
            style={{ width: 150 }}
            value={sortMode}
            title="排序方式（书架 / 平铺均生效）"
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            <option value="added_desc">最新入库</option>
            <option value="added_asc">最早入库</option>
            <option value="rating_desc">评分从高到低</option>
            <option value="title">书名 A-Z</option>
          </select>
          <div className="library-view-switch" role="group" aria-label="排版方式">
            <button
              type="button"
              className={groupMode === 'shelf' ? 'active' : ''}
              onClick={() => setGroupMode('shelf')}
              title="按书架分组"
            >
              <Layers size={14} />
              书架
            </button>
            <button
              type="button"
              className={`library-view-tag ${groupMode === 'tag' ? 'active' : ''}`}
              onClick={() => setGroupMode('tag')}
              title="按标签分组"
            >
              <Tags size={14} />
              标签
            </button>
            <button
              type="button"
              className={groupMode === 'flat' ? 'active' : ''}
              onClick={() => setGroupMode('flat')}
              title="平铺全部"
            >
              <LayoutGrid size={14} />
              平铺
            </button>
          </div>
        </div>

        {libraries.length > 0 && (
          <div className="library-filter-row" aria-label="书架筛选">
            <span
              className={`tag-pill ${!activeLibrary ? 'active' : ''}`}
              onClick={() => setActiveLibrary(null)}
            >
              全部书架
            </span>
            {libraries.map((lib) => (
              <span
                key={lib.id}
                className={`tag-pill ${activeLibrary === lib.id ? 'active' : ''}`}
                onClick={() => setActiveLibrary(activeLibrary === lib.id ? null : lib.id)}
              >
                {lib.name} · {lib.book_count}
              </span>
            ))}
            <span
              className={`tag-pill ${activeLibrary === '__none__' ? 'active' : ''}`}
              onClick={() => setActiveLibrary(activeLibrary === '__none__' ? null : '__none__')}
            >
              未归架
            </span>
          </div>
        )}

        {tags.length > 0 && (
          <div className="library-filter-row library-tag-filter" aria-label="标签筛选">
            <span
              className={`tag-pill ${!activeTag ? 'active' : ''}`}
              onClick={() => setActiveTag(null)}
            >
              全部标签
            </span>
            {tags.map((t) => (
              <span
                key={t.id}
                className={`tag-pill ${activeTag === t.name ? 'active' : ''}`}
                onClick={() => setActiveTag(activeTag === t.name ? null : t.name)}
              >
                {t.name} · {t.book_count}
              </span>
            ))}
          </div>
        )}

        {showRecommended && (
          <section className="home-section library-recommend-section">
            <div className="home-section-header">
              <div className="home-section-title library-recommend-title">高分推荐</div>
            </div>
            <MotionGrid className="book-grid book-grid-row" dense mount ref={recommendedRowRef}>
              {visibleRecommended.map((b) => (
                <BookCard key={`toprated-${b.id}`} book={b} onFavoriteChange={onFavoriteChange} />
              ))}
            </MotionGrid>
          </section>
        )}

        {loading ? (
          <div className="book-grid" aria-busy="true" aria-label="加载中">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton-book-card">
                <div className="skeleton-loader skeleton-book-cover" />
                <div className="skeleton-loader skeleton-line" style={{ width: '84%' }} />
                <div className="skeleton-loader skeleton-line" style={{ width: '54%' }} />
              </div>
            ))}
          </div>
        ) : emptyHint ? (
          <div className="empty-state">
            <BookOpen size={34} style={{ opacity: 0.4 }} />
            <div>{emptyHint}</div>
          </div>
        ) : effectiveGroupMode === 'flat' ? (
          <div className="library-section flat">
            <div className="library-shelf-rail" aria-hidden />
            <MotionGrid className="book-grid" mount>
              {filteredBooks.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  onFavoriteChange={onFavoriteChange}
                  selectable={canBatchDelete}
                  selected={selectedIds.has(b.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </MotionGrid>
          </div>
        ) : (
          <div className="library-sections">
            {sections.map((section) => {
              const isCollapsed = Boolean(collapsed[section.key])
              return (
                <section key={section.key} className="library-section">
                  <button
                    type="button"
                    className="library-section-header"
                    onClick={() => toggleSection(section.key)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="library-section-chevron">
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </span>
                    <span className="library-section-title">{section.title}</span>
                    <span className="library-section-count">{section.books.length}</span>
                    {section.hint && <span className="library-section-hint">{section.hint}</span>}
                  </button>
                  {!isCollapsed && (
                    <>
                      <div className="library-shelf-rail" aria-hidden />
                      <MotionGrid className="book-grid" mount>
                        {section.books.map((b) => (
                          <BookCard
                            key={`${section.key}-${b.id}`}
                            book={b}
                            onFavoriteChange={onFavoriteChange}
                            selectable={canBatchDelete}
                            selected={selectedIds.has(b.id)}
                            onToggleSelect={toggleSelect}
                          />
                        ))}
                      </MotionGrid>
                    </>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      {showBatchDelete && !batchDeleting && (
        <Modal
          title="批量删除书籍"
          onClose={() => setShowBatchDelete(false)}
          width={440}
        >
          <div className="confirm-dialog">
            <div className="confirm-dialog-lead">
              确认删除所选的 <strong>{selectedIds.size}</strong> 本缺少信息的书？
            </div>
            <p className="confirm-dialog-desc">
              将同时删除书库中的本地原文件，以及封面 / 转换副本。此操作不可撤销，重新扫描也不会再找回这些文件。
            </p>
            <div className="confirm-dialog-actions">
              <button className="btn" type="button" onClick={() => setShowBatchDelete(false)}>
                取消
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void batchDeleteSelected()}>
                <Trash2 size={15} />
                确认删除
              </button>
            </div>
          </div>
        </Modal>
      )}

      {batchJob && (
        <Modal
          title={batchJob.kind === 'delete' ? '批量删除' : '重新匹配'}
          onClose={() => {
            if (batchBusy) stopBatchJob()
            else closeBatchModal()
          }}
          width={440}
          closeOnBackdrop={!batchBusy}
        >
          <BatchProgressPanel job={batchJob} onStop={stopBatchJob} onClose={closeBatchModal} />
        </Modal>
      )}

      {showLibraryModal && (
        <LibraryModal
          libraries={libraries}
          onClose={() => setShowLibraryModal(false)}
          onChanged={(opts) => {
            api.get<Library[]>('/api/libraries').then(libs => setLibraries(libs.sort((a, b) => (a.order_index || 0) - (b.order_index || 0)))).catch(() => {})
            void refresh({ silent: opts?.silent })
          }}
        />
      )}
    </>
  )
}

function BatchProgressPanel({
  job,
  onStop,
  onClose,
}: {
  job: BatchProgressJob
  onStop: () => void
  onClose: () => void
}) {
  const isDelete = job.kind === 'delete'
  const done = job.success + job.failed
  const inFlight = job.phase === 'running' || job.phase === 'stopping' ? job.remainingIds.length : 0
  const pct = job.total > 0 ? Math.min(100, Math.round((done / job.total) * 100)) : 0
  const running = job.phase === 'running' || job.phase === 'stopping'

  const title =
    job.phase === 'stopping'
      ? '正在停止…'
      : job.phase === 'stopped'
        ? isDelete
          ? '已停止删除'
          : '已停止匹配'
        : job.phase === 'done'
          ? isDelete
            ? '删除完成'
            : '匹配完成'
          : isDelete
            ? '正在删除…'
            : '正在重新匹配…'

  const sub =
    running && job.currentTitle
      ? `当前：《${job.currentTitle}》`
      : job.phase === 'stopped'
        ? `未处理 ${job.remainingIds.length} 本已保留勾选，可继续操作`
        : job.phase === 'done'
          ? job.failed > 0
            ? isDelete
              ? '删除失败的书仍保留勾选'
              : '未匹配成功的书仍保留勾选'
            : '所选书籍已全部处理完毕'
          : `共 ${job.total} 本，请稍候`

  const pendingLabel = running ? (isDelete ? '删除中' : '匹配中') : '未处理'
  const stopLabel = job.phase === 'stopping' ? '停止中…' : isDelete ? '停止删除' : '停止匹配'

  return (
    <div className="rematch-progress" role="status" aria-live="polite">
      <div className="upload-progress">
        <div className="upload-progress-icon">
          {running ? (
            <Loader2 size={22} className="spin" />
          ) : isDelete ? (
            <Trash2 size={22} />
          ) : (
            <Wand2 size={22} />
          )}
        </div>
        <div className="upload-progress-text">
          <div className="upload-progress-title">{title}</div>
          <div className="upload-progress-sub">{sub}</div>
        </div>
        <div className="upload-progress-bar rematch-progress-bar" aria-hidden="true">
          <span className="rematch-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="rematch-stats" aria-label={isDelete ? '删除进度' : '匹配进度'}>
        <div className="rematch-stat">
          <div className="rematch-stat-value is-ok">{job.success}</div>
          <div className="rematch-stat-label">{isDelete ? '已删除' : '已成功'}</div>
        </div>
        <div className="rematch-stat">
          <div className="rematch-stat-value is-fail">{job.failed}</div>
          <div className="rematch-stat-label">已失败</div>
        </div>
        <div className="rematch-stat">
          <div className="rematch-stat-value is-pending">{inFlight}</div>
          <div className="rematch-stat-label">{pendingLabel}</div>
        </div>
      </div>

      <div className="rematch-progress-meta">
        进度 {done}/{job.total}
        {job.total > 0 ? ` · ${pct}%` : ''}
      </div>

      <div className="confirm-dialog-actions" style={{ marginTop: 18 }}>
        {running ? (
          <button
            type="button"
            className="btn"
            disabled={job.phase === 'stopping'}
            onClick={onStop}
          >
            <Square size={14} />
            {stopLabel}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        )}
      </div>
    </div>
  )
}

function buildBookSections(
  books: BookSummary[],
  mode: GroupMode,
  libraries: Library[],
  tags: Tag[],
): BookSection[] {
  if (mode === 'flat' || books.length === 0) return []

  if (mode === 'shelf') {
    const libMap = new Map(libraries.map((l) => [l.id, l]))
    const byLib = new Map<string, BookSummary[]>()
    const unassigned: BookSummary[] = []
    for (const book of books) {
      if (book.library_id && libMap.has(book.library_id)) {
        const list = byLib.get(book.library_id) || []
        list.push(book)
        byLib.set(book.library_id, list)
      } else {
        unassigned.push(book)
      }
    }
    const sections: BookSection[] = []
    const sortedLibraries = [...libraries].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    for (const lib of sortedLibraries) {
      const list = byLib.get(lib.id)
      if (!list?.length) continue
      sections.push({
        key: `shelf:${lib.id}`,
        title: lib.name,
        books: list,
      })
    }
    // 已删除书架但仍挂着 library_id 的书
    for (const [id, list] of byLib) {
      if (libMap.has(id) || !list.length) continue
      sections.push({
        key: `shelf:${id}`,
        title: '未知书架',
        books: list,
      })
    }
    if (unassigned.length) {
      sections.push({
        key: 'shelf:none',
        title: '未归架',
        hint: '上传入库或尚未归入书架的书',
        books: unassigned,
      })
    }
    return sections
  }

  // 按标签：一书可出现在多个标签下
  const byTag = new Map<string, BookSummary[]>()
  const untagged: BookSummary[] = []
  for (const book of books) {
    if (!book.tags?.length) {
      untagged.push(book)
      continue
    }
    for (const tag of book.tags) {
      const list = byTag.get(tag) || []
      list.push(book)
      byTag.set(tag, list)
    }
  }
  const tagOrder = tags.map((t) => t.name)
  const sections: BookSection[] = []
  for (const name of tagOrder) {
    const list = byTag.get(name)
    if (!list?.length) continue
    sections.push({ key: `tag:${name}`, title: name, books: list })
    byTag.delete(name)
  }
  for (const [name, list] of [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    if (!list.length) continue
    sections.push({ key: `tag:${name}`, title: name, books: list })
  }
  if (untagged.length) {
    sections.push({
      key: 'tag:none',
      title: '未打标签',
      hint: '可在书籍详情中匹配元数据或编辑标签',
      books: untagged,
    })
  }
  return sections
}

function LibraryModal({
  libraries,
  onClose,
  onChanged,
}: {
  libraries: Library[]
  onClose: () => void
  onChanged: (opts?: { silent?: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [watchOnCreate, setWatchOnCreate] = useState(false)
  const [disablingAuto, setDisablingAuto] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Library | null>(null)
  const [deletingLibrary, setDeletingLibrary] = useState(false)
  const watchingCount = libraries.filter((l) => l.scan_mode === 'watch').length

  // 书架排序：拖拽把手改变书架显示顺序（影响「按书架」分组视图与筛选栏顺序）
  const [orderedLibs, setOrderedLibs] = useState<Library[]>(libraries)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  useEffect(() => {
    setOrderedLibs(libraries)
  }, [libraries])

  async function commitOrder(next: Library[]) {
    setOrderedLibs(next)
    setSavingOrder(true)
    try {
      await api.put('/api/libraries/reorder', { library_ids: next.map((l) => l.id) })
      onChanged({ silent: true })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '排序保存失败')
      setOrderedLibs(libraries)
    } finally {
      setSavingOrder(false)
    }
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const next = [...orderedLibs]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(targetIndex, 0, moved)
    setDragIndex(null)
    setDragOverIndex(null)
    void commitOrder(next)
  }

  async function createLibrary() {
    if (!name || !rootPath) return
    setBusy(true)
    try {
      await api.post('/api/libraries', {
        name,
        root_path: rootPath,
        scan_mode: watchOnCreate ? 'watch' : 'manual',
      })
      toast.success(watchOnCreate ? '书架已添加（已开启变动监控）' : '书架已添加（仅手动扫描）')
      setName('')
      setRootPath('')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  async function toggleWatch(lib: Library) {
    const next = lib.scan_mode === 'watch' ? 'manual' : 'watch'
    try {
      await api.patch(`/api/libraries/${lib.id}`, { scan_mode: next })
      toast.success(next === 'watch' ? '已开启目录变动自动刷新' : '已改为仅手动扫描')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '更新失败')
    }
  }

  async function disableAllAutoScan() {
    if (disablingAuto) return
    setDisablingAuto(true)
    try {
      const res = await api.post<{
        disabled_watch_count: number
        cleared_queue: number
      }>('/api/libraries/watch/disable-all')
      toast.success(
        `已关闭全部自动扫描：${res.disabled_watch_count} 个监控已关，定时扫描已关，排队已清空`,
      )
      onChanged({ silent: true })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '关闭失败')
    } finally {
      setDisablingAuto(false)
    }
  }

  async function scanLibrary(id: string) {
    try {
      await api.post(`/api/libraries/${id}/scan`)
      toast.success('已排队后台扫描；大库请用顶栏「停止扫描」随时中止')
      let tries = 0
      const timer = window.setInterval(async () => {
        tries += 1
        try {
          const status = await api.get<{ busy: boolean }>('/api/libraries/scan/status')
          if (!status.busy || tries >= 180) {
            window.clearInterval(timer)
            onChanged({ silent: true })
            if (!status.busy && tries > 1) toast.success('目录扫描已结束')
          }
        } catch {
          if (tries >= 180) window.clearInterval(timer)
        }
      }, 2000)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '扫描失败')
    }
  }

  async function saveRename(id: string) {
    if (!renameValue.trim()) {
      setRenamingId(null)
      return
    }
    try {
      await api.patch(`/api/libraries/${id}`, { name: renameValue.trim() })
      toast.success('映射名已更新')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重命名失败')
    } finally {
      setRenamingId(null)
    }
  }

  async function confirmDeleteLibrary() {
    if (!pendingDelete || deletingLibrary) return
    setDeletingLibrary(true)
    try {
      await api.delete(`/api/libraries/${pendingDelete.id}`)
      toast.success('书架已删除')
      setPendingDelete(null)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setDeletingLibrary(false)
    }
  }

  return (
    <>
    <Modal title="书库目录管理" onClose={onClose} width={620}>
      <div style={{ color: 'var(--ink-faint)', fontSize: 12.5, marginBottom: 12 }}>
        把宿主机上的电子书目录挂载进容器后，在此逐级浏览、选中某个文件夹即可创建一个「书架」；
        书架显示名（映射名）与实际文件夹名相互独立，随时可改。大库（如摄影）请保持「监控关」，只在需要时手动扫描。
      </div>

      {(watchingCount > 0 || libraries.length > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={disablingAuto}
            onClick={disableAllAutoScan}
            title="关闭所有书架监控 + 全局定时扫描，并停止正在进行的扫描"
          >
            {disablingAuto ? '关闭中…' : `关闭全部自动扫描${watchingCount ? `（${watchingCount}）` : ''}`}
          </button>
        </div>
      )}

      {orderedLibs.length > 1 && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          <GripVertical size={12} /> 拖拽左侧手柄可调整书架顺序（影响「按书架」分组与筛选栏排列）
          {savingOrder && <Loader2 size={12} className="spin" />}
        </div>
      )}
      {orderedLibs.map((lib, index) => (
        <div
          key={lib.id}
          className={`citation-item shelf-order-row${dragOverIndex === index && dragIndex !== null && dragIndex !== index ? ' drag-over' : ''}${dragIndex === index ? ' dragging' : ''}`}
          style={{ alignItems: 'center' }}
          onDragOver={(e) => {
            e.preventDefault()
            if (dragOverIndex !== index) setDragOverIndex(index)
          }}
          onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
          onDrop={(e) => {
            e.preventDefault()
            handleDrop(index)
          }}
        >
          <span
            className="shelf-order-handle"
            draggable
            title="拖拽调整顺序"
            aria-label="拖拽调整书架顺序"
            onDragStart={(e) => {
              setDragIndex(index)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              setDragIndex(null)
              setDragOverIndex(null)
            }}
          >
            <GripVertical size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {renamingId === lib.id ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  style={{ padding: '4px 8px', fontSize: 13 }}
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename(lib.id)}
                />
                <button className="btn btn-sm btn-primary" onClick={() => saveRename(lib.id)}>
                  保存
                </button>
              </div>
            ) : (
              <div
                style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                onClick={() => {
                  setRenamingId(lib.id)
                  setRenameValue(lib.name)
                }}
                title="点击重命名映射名"
              >
                {lib.name}
                <Edit3 size={11} style={{ opacity: 0.5 }} />
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lib.root_path}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 3 }}>
              {lib.book_count} 本 · {lib.scan_mode === 'watch' ? '监控中' : '手动'} ·{' '}
              {lib.last_scanned_at ? `上次扫描 ${new Date(lib.last_scanned_at).toLocaleString()}` : '尚未扫描'}
            </div>
          </div>
          <button
            className={`btn btn-sm ${lib.scan_mode === 'watch' ? 'btn-primary' : ''}`}
            onClick={() => toggleWatch(lib)}
            title={lib.scan_mode === 'watch' ? '关闭自动监控' : '开启目录变动自动刷新'}
          >
            {lib.scan_mode === 'watch' ? '监控开' : '监控关'}
          </button>
          <button className="btn btn-sm" onClick={() => scanLibrary(lib.id)}>
            扫描
          </button>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setPendingDelete(lib)} title="删除书架">
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      <div className="divider" />

      <div className="field">
        <label>映射名（显示在书库筛选中的书架名称）</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：神学资料" />
      </div>
      <div className="field">
        <label>源目录（容器内绝对路径）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="点击右侧「浏览挂载目录」选择，或手动填写"
          />
          <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => setShowBrowser((v) => !v)}>
            <FolderPlus size={14} />
            浏览挂载目录
          </button>
        </div>
      </div>

      {showBrowser && (
        <DirectoryBrowser
          onPick={(path, folderName) => {
            setRootPath(path)
            if (!name) setName(folderName)
            setShowBrowser(false)
          }}
        />
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 12 }}>
        <input type="checkbox" checked={watchOnCreate} onChange={(e) => setWatchOnCreate(e.target.checked)} />
        开启目录变动自动刷新（默认关闭；大库勿开，避免自动扫入新书）
      </label>

      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={createLibrary} disabled={busy}>
        {busy ? '添加中…' : '添加书架'}
      </button>
    </Modal>

    {pendingDelete && (
      <ConfirmDialog
        title="删除书架"
        lead={
          <>
            确认删除书架「<strong>{pendingDelete.name}</strong>」？
          </>
        }
        description="不会删除已入库的书籍，仅解除目录关联。"
        busy={deletingLibrary}
        onClose={() => !deletingLibrary && setPendingDelete(null)}
        onConfirm={confirmDeleteLibrary}
      />
    )}
    </>
  )
}

function DirectoryBrowser({ onPick }: { onPick: (absolutePath: string, folderName: string) => void }) {
  const [data, setData] = useState<BrowseResult | null>(null)
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(true)

  async function load(path: string) {
    setLoading(true)
    try {
      const res = await api.get<BrowseResult>(`/api/libraries/browse?path=${encodeURIComponent(path)}`)
      setData(res)
      setCurrentPath(res.path)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '浏览目录失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const crumbs = currentPath ? currentPath.split('/').filter(Boolean) : []

  return (
    <div className="dir-browser">
      {loading ? (
        <div className="empty-state" style={{ minHeight: 120 }}>
          <div className="spinner" />
        </div>
      ) : !data?.mount_ready ? (
        <div className="empty-state" style={{ minHeight: 120, padding: 20 }}>
          <div style={{ fontSize: 13 }}>
            尚未检测到挂载目录（{data?.mount_root}）。请在 docker-compose.yml 中把宿主机电子书目录以可读写方式挂载到该路径后重启容器，例如：
          </div>
          <code style={{ fontSize: 11.5, marginTop: 8, display: 'block' }}>
            /path/to/your/ebooks:/library-source
          </code>
        </div>
      ) : (
        <>
          <div className="dir-browser-crumbs">
            <span className="dir-crumb" onClick={() => load('')}>
              根目录
            </span>
            {crumbs.map((c, i) => (
              <span key={i}>
                <span className="dir-crumb-sep">/</span>
                <span className="dir-crumb" onClick={() => load(crumbs.slice(0, i + 1).join('/'))}>
                  {c}
                </span>
              </span>
            ))}
          </div>

          {data.permission_denied && (
            <div className="empty-state" style={{ minHeight: 'auto', padding: '10px 14px', textAlign: 'left' }}>
              <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
                读取该目录被拒绝（权限不足）。若使用 Docker Desktop / OrbStack，请在其"文件共享"设置中为宿主机路径
                （{data.mount_root}）授权后重启容器，而不是代码问题。
              </div>
            </div>
          )}
          <div className="dir-browser-list">
            {data.entries.length === 0 && !data.permission_denied && (
              <div style={{ padding: 14, fontSize: 12.5, color: 'var(--ink-faint)' }}>此目录下没有子文件夹</div>
            )}
            {data.entries.map((entry) => (
              <div key={entry.path} className="dir-browser-row" onClick={() => load(entry.path)}>
                <FolderPlus size={14} style={{ opacity: 0.6 }} />
                <span style={{ flex: 1 }}>{entry.name}</span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPick(`${data.mount_root}/${entry.path}`.replace(/\/+/g, '/'), entry.name)
                  }}
                >
                  选择
                </button>
              </div>
            ))}
          </div>

          {data.path && (
            <button
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => onPick(data.absolute_path, data.path.split('/').pop() || data.path)}
            >
              直接使用当前目录「{data.path}」
            </button>
          )}
        </>
      )}
    </div>
  )
}
