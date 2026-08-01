import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BookText, Feather, FileSearch, Highlighter, Search } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { GlobalSearchResult } from '../api/types'
import { formatChipClass, formatLabel } from '../lib/bookFormat'
import { HighlightedText } from '../lib/highlightQuery'
import { readerDeepLink } from '../lib/readerDeepLink'

const EMPTY: GlobalSearchResult = { books: [], highlights: [], citations: [], fulltext: [] }

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const [q, setQ] = useState(searchParams.get('q') || '')
  const [activeQuery, setActiveQuery] = useState('')
  const [result, setResult] = useState<GlobalSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const navigate = useNavigate()

  async function run(keyword?: string) {
    const value = (keyword ?? q).trim()
    if (!value) return
    setLoading(true)
    setSearched(true)
    try {
      // 与首页搜索框同一接口：书名 / 高亮 / 引用 / 正文
      const data = await api.get<GlobalSearchResult>(`/api/search/global?q=${encodeURIComponent(value)}`)
      setActiveQuery(value)
      setResult({
        books: data.books || [],
        highlights: data.highlights || [],
        citations: data.citations || [],
        fulltext: data.fulltext || [],
      })
    } catch (err) {
      setResult(EMPTY)
      toast.error(err instanceof ApiError ? err.message : '检索失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const initial = searchParams.get('q')
    if (initial) run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasHits =
    !!result &&
    (result.books.length > 0 ||
      result.highlights.length > 0 ||
      result.citations.length > 0 ||
      result.fulltext.length > 0)

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">全库检索</div>
          <div className="page-subtitle">搜索书名、作者、高亮笔记、引用与已索引正文（与首页搜索同一数据源）</div>
        </div>
      </div>
      <div className="page-content">
        <div className="search-bar" style={{ maxWidth: 560, marginBottom: 24 }}>
          <label className="search-bar-field">
            <Search size={16} aria-hidden />
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="输入书名、作者或关键词…"
              autoFocus
              aria-label="搜索关键词"
            />
          </label>
          <button type="button" className="btn btn-primary search-bar-submit" onClick={() => run()} disabled={loading}>
            {loading ? '搜索中' : '搜索'}
          </button>
        </div>

        {loading && (
          <div className="empty-state">
            <div className="spinner" />
          </div>
        )}

        {!loading && searched && !hasHits && <div className="empty-state">没有找到相关内容</div>}

        {!loading && result && result.books.length > 0 && (
          <section className="search-page-group">
            <div className="search-page-group-title">
              <BookText size={15} /> 书籍
              <span>{result.books.length}</span>
            </div>
            <div className="search-page-books">
              {result.books.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="search-page-book"
                  onClick={() => navigate(`/books/${b.id}`)}
                >
                  <div className="search-page-book-cover">
                    {b.cover_url ? (
                      <img src={b.cover_url} alt="" loading="lazy" />
                    ) : (
                      <span>{(b.title || '?').slice(0, 1)}</span>
                    )}
                    {b.file_format ? (
                      <div
                        className={`${formatChipClass(b.file_format)} compact`}
                        title={`格式：${formatLabel(b.file_format)}`}
                      >
                        {formatLabel(b.file_format)}
                      </div>
                    ) : null}
                    {b.reading_status === 'finished' && (
                      <span className="book-finished-badge compact" title="已读完">
                        已读
                      </span>
                    )}
                  </div>
                  <div className="search-page-book-body">
                    <div className="search-page-book-title">{b.title}</div>
                    <div className="search-page-book-meta">{b.authors.join('、') || '佚名'}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {!loading && result && result.highlights.length > 0 && (
          <section className="search-page-group">
            <div className="search-page-group-title">
              <Highlighter size={15} /> 高亮笔记
              <span>{result.highlights.length}</span>
            </div>
            {result.highlights.map((h) => (
              <button
                key={h.id}
                type="button"
                className="highlight-item card search-page-hit"
                onClick={() => navigate(readerDeepLink(h.book_id, { cfi: h.cfi_range, q: activeQuery }))}
              >
                <div className="search-page-hit-meta">
                  <span>{h.book_title}</span>
                  <span>{h.chapter_title}</span>
                </div>
                <div className="search-page-hit-text">
                  <HighlightedText text={h.quoted_text} query={activeQuery} />
                </div>
                {h.note ? (
                  <div className="search-page-hit-note">
                    <HighlightedText text={h.note} query={activeQuery} />
                  </div>
                ) : null}
              </button>
            ))}
          </section>
        )}

        {!loading && result && result.citations.length > 0 && (
          <section className="search-page-group">
            <div className="search-page-group-title">
              <Feather size={15} /> 引用篮
              <span>{result.citations.length}</span>
            </div>
            {result.citations.map((c) => (
              <button
                key={c.id}
                type="button"
                className="highlight-item card search-page-hit"
                onClick={() => navigate(`/citation?project=${c.project_id}&item=${c.id}`)}
              >
                <div className="search-page-hit-meta">
                  <span>{c.project_name}</span>
                  <span>{c.book_title}</span>
                </div>
                <div className="search-page-hit-text">
                  <HighlightedText text={c.quoted_text} query={activeQuery} />
                </div>
              </button>
            ))}
          </section>
        )}

        {!loading && result && result.fulltext.length > 0 && (
          <section className="search-page-group">
            <div className="search-page-group-title">
              <FileSearch size={15} /> 正文
              <span>{result.fulltext.length}</span>
            </div>
            {result.fulltext.map((f, i) => (
              <button
                key={`${f.book_id}-${f.cfi_anchor}-${i}`}
                type="button"
                className="highlight-item card search-page-hit"
                onClick={() => navigate(readerDeepLink(f.book_id, { cfi: f.cfi_anchor, q: activeQuery }))}
              >
                <div className="search-page-hit-meta">
                  <span>{f.book_title}</span>
                  <span>{f.chapter_title}</span>
                </div>
                <div className="search-page-hit-text">
                  <HighlightedText text={f.snippet} query={activeQuery} />
                </div>
              </button>
            ))}
          </section>
        )}
      </div>
    </>
  )
}
