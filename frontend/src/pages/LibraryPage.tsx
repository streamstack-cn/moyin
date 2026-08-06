import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  LayoutGrid,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { BookSummary, Library, Tag } from '../api/types'
import AnimatedNumber from '../components/AnimatedNumber'
import BookCard from '../components/BookCard'
import {
  BatchProgressPanel,
  type BatchProgressJob,
} from '../components/library/BatchProgressPanel'
import { LibraryModal } from '../components/library/LibraryModal'
import Modal from '../components/Modal'
import MotionGrid from '../components/MotionGrid'
import { PageSeg, PageSegItem } from '../components/PageSeg'
import { useAuth } from '../contexts/AuthContext'
import { trackGlow } from '../lib/glowTrack'
import { buildBookSections } from '../lib/librarySections'
import { bumpRecommendOffset, pickRecommendedBooks } from '../lib/recommendedBooks'
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

const GROUP_MODE_KEY = 'moyin_library_group_mode'
const COLLAPSED_KEY = 'moyin_library_collapsed'
const BATCH_SELECT_KEY = 'moyin_batch_select_missing'
/** 单次批量重新匹配上限（与后端一致） */
const BATCH_REMATCH_LIMIT = 200

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

  // 读者账号不可见「缺少信息」；若带了 meta=missing_douban 则清掉
  useEffect(() => {
    if (user?.role === 'admin') return
    if (metaFilter !== 'missing_douban') return
    setMetaFilter('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, metaFilter])

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

  // 高分推荐：首行展示；未读优先 + 日更轮换 + 可「换一批」，避免永远只露同一排高分书
  const [recommendedCapacity, recommendedRowRef] = useRowCapacity({ minItemWidth: 158, gap: 22, min: 2, max: 16 })
  const [recommendTick, setRecommendTick] = useState(0)
  const { pool: recommendPool, visible: visibleRecommended } = useMemo(() => {
    void recommendTick
    return pickRecommendedBooks(books, recommendedCapacity)
  }, [books, recommendedCapacity, recommendTick])
  const showRecommended =
    !loading && !metaFilter && !q && !activeTag && !activeLibrary && !status && visibleRecommended.length > 0

  function shuffleRecommended() {
    bumpRecommendOffset(recommendPool.length, Math.max(recommendedCapacity, 2))
    setRecommendTick((n) => n + 1)
  }

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <>
      <div className="topbar library-topbar">
        <div className="library-topbar-heading page-heading">
          <h1 className="page-title">我的书库</h1>
          <p className="page-subtitle">按书架与标签浏览 · 标注 · 沉淀写作引用</p>
        </div>
        <div className="library-topbar-actions">
          <PageSeg aria-label="书库操作">
            {user?.role === 'admin' && (
              <>
                <PageSegItem
                  icon={<RefreshCw size={15} className={scanningAll || scanBusy ? 'spin' : undefined} />}
                  label={scanningAll || scanBusy ? '扫描中…' : '扫描书库'}
                  shortLabel={scanningAll || scanBusy ? '扫描中' : '扫描'}
                  onClick={scanAllLibraries}
                  disabled={scanningAll || scanBusy}
                  title="扫描全部书库目录并同步增删"
                />
                {(scanBusy || stoppingScan) && (
                  <PageSegItem
                    tone="danger"
                    primary
                    label={stoppingScan ? '停止中…' : '停止扫描'}
                    shortLabel={stoppingScan ? '停止中' : '停止'}
                    onClick={stopScan}
                    disabled={stoppingScan}
                    title="立刻清空排队并中止当前扫描，避免大库继续入库"
                  />
                )}
                <PageSegItem
                  icon={<FolderPlus size={15} />}
                  label="管理书库目录"
                  shortLabel="目录"
                  onClick={() => setShowLibraryModal(true)}
                  title="管理书库目录"
                />
              </>
            )}
            <PageSegItem
              primary
              icon={<UploadCloud size={15} />}
              label="上传电子书"
              shortLabel="上传"
              title="上传电子书（入库后全员可见）"
              onClick={() => {
                setUploadFile(null)
                setUploadLibraryId(
                  activeLibrary && activeLibrary !== '__none__' ? activeLibrary : '__none__',
                )
                setShowUploadModal(true)
              }}
            />
          </PageSeg>
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
                  // 弹窗内已有进度区，不再额外 toast.loading，避免与弹窗叠两层
                  try {
                    await api.upload('/api/books/upload', formData)
                    const shelf =
                      uploadLibraryId === '__none__'
                        ? '未归架'
                        : libraries.find((l) => l.id === uploadLibraryId)?.name || '目标书架'
                    toast.success(`导入成功 · ${shelf}`)
                    setShowUploadModal(false)
                    setUploadFile(null)
                    refresh()
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : '导入失败')
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
          {user?.role === 'admin' && (
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
          )}
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
            <Search size={16} className="search-box-icon" aria-hidden />
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
          <PageSeg className="library-view-switch" role="group" aria-label="排版方式">
            <PageSegItem
              icon={<Layers size={14} />}
              label="书架"
              active={groupMode === 'shelf'}
              onClick={() => setGroupMode('shelf')}
              title="按书架分组"
            />
            <PageSegItem
              className="library-view-tag"
              icon={<Tags size={14} />}
              label="标签"
              active={groupMode === 'tag'}
              onClick={() => setGroupMode('tag')}
              title="按标签分组"
            />
            <PageSegItem
              icon={<LayoutGrid size={14} />}
              label="平铺"
              active={groupMode === 'flat'}
              onClick={() => setGroupMode('flat')}
              title="平铺全部"
            />
          </PageSeg>
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
              <div className="home-section-title">高分推荐</div>
              {recommendPool.length > visibleRecommended.length && (
                <button type="button" className="btn btn-sm library-recommend-shuffle" onClick={shuffleRecommended}>
                  <RefreshCw size={13} /> 换一批
                </button>
              )}
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
