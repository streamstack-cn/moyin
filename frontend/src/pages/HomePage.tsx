import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, BookOpen, Layers, Search, Trash2, X } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { BookSummary, GlobalSearchResult, HomeFeed, HomeSnippet } from '../api/types'
import BookCard from '../components/BookCard'
import GlobalSearchResults from '../components/GlobalSearchResults'
import Modal from '../components/Modal'
import { useAuth } from '../contexts/AuthContext'
import { formatChipClass, formatLabel } from '../lib/bookFormat'
import { readerDeepLink } from '../lib/readerDeepLink'

const EMPTY_SEARCH: GlobalSearchResult = { books: [], highlights: [], citations: [], fulltext: [] }

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 19) return '下午好'
  return '晚上好'
}

function useQuoteCapacity(containerRef: RefObject<HTMLDivElement | null>) {
  const [count, setCount] = useState(6)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const update = () => {
      const w = el.clientWidth || 320
      const colMin = w < 480 ? 240 : 280
      const cols = Math.max(1, Math.floor((w + 16) / (colMin + 16)))
      const rows = w < 640 ? 2 : w < 1100 ? 2 : 2
      setCount(Math.max(2, Math.min(12, cols * rows)))
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  return count
}

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [feed, setFeed] = useState<HomeFeed | null>(null)
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  const [activeQuery, setActiveQuery] = useState('')
  const [searchResult, setSearchResult] = useState<GlobalSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quotesRef = useRef<HTMLDivElement>(null)
  const quoteCapacity = useQuoteCapacity(quotesRef)

  useEffect(() => {
    api
      .get<HomeFeed>('/api/books/home')
      .then(setFeed)
      .finally(() => setLoading(false))
  }, [])

  async function runSearch(keyword: string) {
    const value = keyword.trim()
    if (!value) {
      setSearchResult(null)
      setActiveQuery('')
      setHasSearched(false)
      setSearchParams({}, { replace: true })
      return
    }
    setSearching(true)
    setHasSearched(true)
    try {
      const data = await api.get<GlobalSearchResult>(`/api/search/global?q=${encodeURIComponent(value)}`)
      setActiveQuery(value)
      setSearchResult({
        books: data.books || [],
        highlights: data.highlights || [],
        citations: data.citations || [],
        fulltext: data.fulltext || [],
      })
      setSearchParams({ q: value }, { replace: true })
    } catch (err) {
      setSearchResult(EMPTY_SEARCH)
      toast.error(err instanceof ApiError ? err.message : '检索失败')
    } finally {
      setSearching(false)
    }
  }

  function onQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setSearchResult(null)
      setActiveQuery('')
      setHasSearched(false)
      setSearchParams({}, { replace: true })
      return
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(value)
    }, 360)
  }

  function clearSearch() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setQuery('')
    setActiveQuery('')
    setSearchResult(null)
    setHasSearched(false)
    setSearchParams({}, { replace: true })
  }

  useEffect(() => {
    const initial = searchParams.get('q')
    if (initial?.trim()) {
      setQuery(initial)
      void runSearch(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="empty-state" style={{ minHeight: '70vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  const hasContinue = (feed?.continue_reading?.length ?? 0) > 0
  const hasRecent = (feed?.recent?.length ?? 0) > 0
  const snippets = feed?.recent_snippets || []
  const visibleSnippets = snippets.slice(0, quoteCapacity)
  const showFeed = !hasSearched

  return (
    <>
      <div className="topbar home-topbar">
        <div className="home-topbar-greeting">
          <div className="page-title">
            {greeting()}
            {user?.display_name ? `，${user.display_name}` : ''}
          </div>
          <div className="page-subtitle">今天也来读一会儿书吧</div>
        </div>

        <div className="home-topbar-search">
          <label className="home-search-field">
            <Search size={17} aria-hidden />
            <input
              className="input"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (debounceRef.current) clearTimeout(debounceRef.current)
                  void runSearch(query)
                }
              }}
              placeholder="搜索书名、高亮、引用…"
              aria-label="全库检索"
              autoComplete="off"
            />
            {query ? (
              <button type="button" className="icon-btn home-search-clear" onClick={clearSearch} aria-label="清空搜索">
                <X size={15} />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className="btn btn-primary home-search-submit"
            disabled={searching || !query.trim()}
            onClick={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current)
              void runSearch(query)
            }}
          >
            {searching ? '搜索中' : '搜索'}
          </button>
        </div>

        <div className="home-topbar-trailing">
          <button type="button" className="btn home-library-btn" onClick={() => navigate('/library')}>
            <Layers size={16} />
            <span className="btn-label-full">进入书库</span>
            <span className="btn-label-short">书库</span>
          </button>
        </div>
      </div>

      <div className="page-content home-page">
        {hasSearched && (
          <section className="home-section home-search-section">
            <div className="home-section-header">
              <div className="home-section-title">
                检索结果
                {activeQuery ? <span className="home-search-query">「{activeQuery}」</span> : null}
              </div>
              <button type="button" className="home-section-link" onClick={clearSearch}>
                返回首页 <ArrowRight size={13} />
              </button>
            </div>
            {searching ? (
              <div className="empty-state">
                <div className="spinner" />
              </div>
            ) : (
              searchResult && <GlobalSearchResults result={searchResult} activeQuery={activeQuery} />
            )}
          </section>
        )}

        {showFeed && snippets.length > 0 && (
          <section className="home-section home-quotes-section">
            <div className="home-section-header">
              <div className="home-section-title">摘录与引用</div>
              <button type="button" className="home-section-link" onClick={() => navigate('/citation')}>
                引用篮 <ArrowRight size={13} />
              </button>
            </div>
            <div className="home-quotes-grid" ref={quotesRef}>
              {visibleSnippets.map((s, index) => (
                <SnippetCard
                  key={`${s.kind}-${s.id}`}
                  snippet={s}
                  index={index}
                  onRemoved={(kind, id) => {
                    setFeed((prev) =>
                      prev
                        ? {
                            ...prev,
                            recent_snippets: (prev.recent_snippets || []).filter(
                              (x) => !(x.kind === kind && x.id === id),
                            ),
                          }
                        : prev,
                    )
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {showFeed && hasContinue && (
          <section className="home-section">
            <div className="home-section-header">
              <div className="home-section-title">继续阅读</div>
              <button className="home-section-link" onClick={() => navigate('/library?status=reading')}>
                查看全部 <ArrowRight size={13} />
              </button>
            </div>
            <div className="continue-shelf">
              {feed!.continue_reading.map((b) => (
                <ContinueCard
                  key={b.id}
                  book={b}
                  onDismissed={(id) => {
                    setFeed((prev) =>
                      prev
                        ? {
                            ...prev,
                            continue_reading: prev.continue_reading.filter((x) => x.id !== id),
                          }
                        : prev,
                    )
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {showFeed && (
          <section className="home-section">
            <div className="home-section-header">
              <div className="home-section-title">最新入库</div>
              <button className="home-section-link" onClick={() => navigate('/library')}>
                查看全部 <ArrowRight size={13} />
              </button>
            </div>
            {hasRecent ? (
              <div className="book-grid">
                {feed!.recent.map((b) => (
                  <BookCard
                    key={b.id}
                    book={b}
                    onFavoriteChange={(id, isFavorite) => {
                      setFeed((prev) =>
                        prev
                          ? {
                              ...prev,
                              recent: prev.recent.map((x) =>
                                x.id === id ? { ...x, is_favorite: isFavorite } : x,
                              ),
                              continue_reading: prev.continue_reading.map((x) =>
                                x.id === id ? { ...x, is_favorite: isFavorite } : x,
                              ),
                            }
                          : prev,
                      )
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <BookOpen size={34} style={{ opacity: 0.4 }} />
                <div>书库还是空的，去书库页上传第一本电子书吧</div>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}

function SnippetCard({
  snippet,
  index,
  onRemoved,
}: {
  snippet: HomeSnippet
  index: number
  onRemoved: (kind: HomeSnippet['kind'], id: string) => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isCitation = snippet.kind === 'citation'
  const text =
    snippet.quoted_text.length > 160
      ? `${snippet.quoted_text.slice(0, 160).trim()}…`
      : snippet.quoted_text

  function openBasket(e?: React.MouseEvent) {
    e?.stopPropagation()
    if (isCitation && snippet.project_id) {
      navigate(`/citation?project=${snippet.project_id}&item=${snippet.id}`)
      return
    }
    void openInBook()
  }

  async function openInBook(e?: React.MouseEvent) {
    e?.stopPropagation()
    if (!snippet.book_id) {
      if (isCitation) openBasket()
      return
    }
    const full = snippet.quoted_text.trim()
    const q = full.slice(0, 80)
    const format = (snippet.file_format || '').toLowerCase()
    const isPdf = format === 'pdf'
    const cfi = (snippet.cfi_range || '').trim()
    // 可用书内定位：EPUB CFI / 章节 href / PDF locator；勿把纸书页码误当成 PDF 页
    const usableCfi =
      Boolean(cfi) &&
      (cfi.startsWith('epubcfi(') ||
        cfi.startsWith('pdf:') ||
        /\.(x?html?|xml)([#?]|$)/i.test(cfi) ||
        (!isPdf && !/^\d+$/.test(cfi)))

    if (usableCfi) {
      navigate(readerDeepLink(snippet.book_id, { cfi, q: q || null }))
      return
    }

    // 旧引用常只有纸书页码：用原文检索章节锚点，再跳转并闪高亮
    if (full) {
      const queries = [full.slice(0, 48), full.slice(0, 24), full.slice(0, 12)]
        .map((s) => s.trim())
        .filter((s, i, arr) => s.length >= 6 && arr.indexOf(s) === i)
      for (const query of queries) {
        try {
          const { results } = await api.get<{ results: { cfi_anchor: string }[] }>(
            `/api/search/book/${snippet.book_id}?q=${encodeURIComponent(query)}`,
          )
          const hit = (results?.[0]?.cfi_anchor || '').trim()
          if (hit) {
            navigate(readerDeepLink(snippet.book_id, { cfi: hit, q: query }))
            return
          }
        } catch {
          /* try shorter query */
        }
      }
    }

    if (isPdf) {
      const page = (snippet.page_no || '').trim()
      if (page && /^\d+$/.test(page)) {
        navigate(readerDeepLink(snippet.book_id, { cfi: `pdf:#page=${page}`, q: q || null }))
        return
      }
    }

    // 仍无锚点时带上搜索词，阅读页会自动搜并跳
    navigate(readerDeepLink(snippet.book_id, { q: q || null }))
  }

  function askRemove(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (busy) return
    setConfirmOpen(true)
  }

  async function confirmRemove() {
    if (busy) return
    setBusy(true)
    try {
      if (isCitation) {
        await api.delete(`/api/citation/items/${snippet.id}?also_highlight=true`)
        toast.success('已删除引用' + (snippet.highlight_id ? '及关联高亮' : ''))
      } else {
        await api.delete(`/api/highlights/${snippet.id}?also_citations=true`)
        toast.success('已删除高亮')
      }
      setConfirmOpen(false)
      onRemoved(snippet.kind, snippet.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  const metaLine = isCitation
    ? snippet.group_name || (snippet.page_no ? `第 ${snippet.page_no} 页` : '打开引用篮')
    : snippet.chapter_title || (snippet.page_no ? `第 ${snippet.page_no} 页` : '回到高亮位置')

  const projectName = (snippet.project_name || '').trim()
  const basketLabel = projectName
    ? projectName.endsWith('引用篮') && projectName.length > 3
      ? projectName.slice(0, -3).trim() || projectName
      : projectName
    : ''

  return (
    <>
    <div
      className={`home-quote-card home-quote-card-${snippet.kind}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <button
        type="button"
        className="home-quote-dismiss"
        title={isCitation ? '删除引用' : '删除高亮'}
        aria-label={isCitation ? '删除引用' : '删除高亮'}
        disabled={busy}
        onClick={askRemove}
      >
        <X size={14} />
      </button>
      <div className="home-quote-head">
        <div className="home-quote-badges">
          <span className={`home-snippet-badge home-snippet-badge-${snippet.kind}`}>
            {isCitation ? '引用' : '高亮'}
          </span>
          {basketLabel ? (
            <button
              type="button"
              className="home-snippet-badge home-snippet-badge-basket"
              title={`打开引用篮「${projectName}」`}
              onClick={openBasket}
            >
              {basketLabel}
            </button>
          ) : null}
        </div>
        <span className="home-quote-mark" aria-hidden>
          “
        </span>
      </div>
      <button
        type="button"
        className="home-quote-text-btn"
        title="跳转到书中原文"
        onClick={(e) => void openInBook(e)}
      >
        <p className="home-quote-text">{text}</p>
        {snippet.note ? <p className="home-quote-note">{snippet.note}</p> : null}
      </button>
      <button
        type="button"
        className="home-quote-footer home-quote-footer-btn"
        title={isCitation ? '打开引用篮' : '跳转到书中原文'}
        onClick={isCitation ? openBasket : (e) => void openInBook(e)}
      >
        <div className="home-quote-cover">
          {snippet.cover_url ? (
            <img src={snippet.cover_url} alt="" loading="lazy" />
          ) : (
            <span>{(snippet.book_title || '?').slice(0, 1)}</span>
          )}
        </div>
        <div className="home-quote-meta">
          <div className="home-quote-book">{snippet.book_title || '未关联书籍'}</div>
          <div className="home-quote-chapter">{metaLine}</div>
        </div>
      </button>
    </div>

    {confirmOpen && (
      <Modal
        title={isCitation ? '删除引用' : '删除高亮'}
        onClose={() => !busy && setConfirmOpen(false)}
        width={420}
        closeOnBackdrop={!busy}
      >
        <div className="confirm-dialog">
          <div className="confirm-dialog-lead">
            {isCitation ? '确认删除这条引用？' : '确认删除这条高亮？'}
          </div>
          <p className="confirm-dialog-desc">
            {isCitation
              ? '若该引用关联了书内高亮，将一并从书中移除。此操作不可撤销。'
              : '若已加入引用篮，将一并移除对应引用。此操作不可撤销。'}
          </p>
          {snippet.quoted_text ? (
            <p className="confirm-dialog-quote">「{text}」</p>
          ) : null}
          <div className="confirm-dialog-actions">
            <button className="btn" type="button" disabled={busy} onClick={() => setConfirmOpen(false)}>
              取消
            </button>
            <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void confirmRemove()}>
              <Trash2 size={15} />
              {busy ? '删除中…' : '确认删除'}
            </button>
          </div>
        </div>
      </Modal>
    )}
    </>
  )
}

function ContinueCard({
  book,
  onDismissed,
}: {
  book: BookSummary
  onDismissed: (id: string) => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function dismiss(e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      await api.put(`/api/books/${book.id}/progress`, {
        status: 'unread',
        location: '',
        percent: 0,
      })
      toast.success(`已从继续阅读移除《${book.title}》`)
      onDismissed(book.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="continue-card" onClick={() => navigate(`/read/${book.id}`)}>
      <div className="continue-cover">
        {book.cover_url ? (
          <img src={book.cover_url} alt={book.title} loading="lazy" />
        ) : (
          <div className="book-cover-placeholder">{book.title}</div>
        )}
        <div className={formatChipClass(book.file_format)} title={`格式：${formatLabel(book.file_format)}`}>
          {formatLabel(book.file_format)}
        </div>
        <button
          type="button"
          className="continue-dismiss"
          title="取消继续阅读，设为未读"
          aria-label="取消继续阅读"
          disabled={busy}
          onClick={dismiss}
        >
          <X size={14} />
        </button>
        <div className="continue-overlay">
          <div className="continue-play">
            <BookOpen size={16} />
            继续阅读
          </div>
        </div>
      </div>
      <div className="continue-progress-track">
        <div className="continue-progress-fill" style={{ width: `${book.reading_percent}%` }} />
      </div>
      <div className="continue-meta">
        <div className="continue-title">{book.title}</div>
        <div className="continue-percent">{Math.round(book.reading_percent)}%</div>
      </div>
    </div>
  )
}
