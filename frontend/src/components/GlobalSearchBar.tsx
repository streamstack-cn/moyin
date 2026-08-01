import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookText, Feather, FileSearch, Highlighter, Search, X } from 'lucide-react'
import { api } from '../api/client'
import type { GlobalSearchResult } from '../api/types'
import { formatChipClass, formatLabel } from '../lib/bookFormat'
import { HighlightedText } from '../lib/highlightQuery'
import { readerDeepLink } from '../lib/readerDeepLink'

export default function GlobalSearchBar() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  /** 与当前结果对应的关键词，避免输入中途改字导致高亮对不上 */
  const [activeQuery, setActiveQuery] = useState('')
  const [result, setResult] = useState<GlobalSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function onChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setResult(null)
      setActiveQuery('')
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      const keyword = value.trim()
      setLoading(true)
      try {
        const data = await api.get<GlobalSearchResult>(`/api/search/global?q=${encodeURIComponent(keyword)}`)
        setActiveQuery(keyword)
        setResult(data)
        setOpen(true)
      } catch {
        setResult(null)
        setActiveQuery('')
      } finally {
        setLoading(false)
      }
    }, 320)
  }

  function reset() {
    setQuery('')
    setActiveQuery('')
    setResult(null)
    setOpen(false)
  }

  const hasHits =
    !!result &&
    (result.books.length > 0 || result.highlights.length > 0 || result.citations.length > 0 || result.fulltext.length > 0)

  return (
    <div className="global-search" ref={boxRef}>
      <div className="global-search-box">
        <Search size={16} />
        <input
          className="input"
          placeholder="搜索书籍、高亮笔记、引用与脚注…"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => result && setOpen(true)}
        />
        {query && (
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={reset}>
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="global-search-panel">
          {loading && (
            <div className="empty-state" style={{ padding: 20 }}>
              <div className="spinner" />
            </div>
          )}

          {!loading && !hasHits && <div className="global-search-empty">没有找到相关内容</div>}

          {!loading && result && result.books.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-title">
                <BookText size={13} /> 书籍
              </div>
              {result.books.map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  className="global-search-item with-cover"
                  onClick={() => {
                    navigate(`/books/${b.id}`)
                    setOpen(false)
                  }}
                >
                  <div className="global-search-cover">
                    {b.cover_url ? (
                      <img src={b.cover_url} alt="" loading="lazy" />
                    ) : (
                      <div className="global-search-cover-fallback">
                        <BookText size={14} />
                      </div>
                    )}
                    {b.file_format ? (
                      <div className={`${formatChipClass(b.file_format)} compact`} title={`格式：${formatLabel(b.file_format)}`}>
                        {formatLabel(b.file_format)}
                      </div>
                    ) : null}
                    {b.reading_status === 'finished' && (
                      <span className="book-finished-badge compact" title="已读完">
                        已读
                      </span>
                    )}
                  </div>
                  <div className="global-search-item-body">
                    <div className="global-search-item-title">{b.title}</div>
                    <div className="global-search-item-meta">{b.authors.join('、') || '佚名'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && result && result.highlights.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-title">
                <Highlighter size={13} /> 高亮与笔记
              </div>
              {result.highlights.map((h) => (
                <div
                  key={h.id}
                  role="button"
                  tabIndex={0}
                  className="global-search-item"
                  onClick={() => {
                    navigate(readerDeepLink(h.book_id, { cfi: h.cfi_range, q: activeQuery }))
                    setOpen(false)
                  }}
                >
                  <div className="global-search-item-title global-search-item-snippet">
                    <span className="highlight-swatch" style={{ background: h.color }} />
                    <HighlightedText text={h.quoted_text} query={activeQuery} />
                  </div>
                  <div className="global-search-item-meta">
                    《{h.book_title}》{h.chapter_title ? ` · ${h.chapter_title}` : ''}
                    {h.note ? (
                      <>
                        {' '}
                        · 笔记：
                        <HighlightedText text={h.note} query={activeQuery} />
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && result && result.citations.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-title">
                <Feather size={13} /> 引用与脚注
              </div>
              {result.citations.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  className="global-search-item"
                  onClick={() => {
                    navigate(`/citation?project=${c.project_id}&item=${c.id}`)
                    setOpen(false)
                  }}
                >
                  <div className="global-search-item-title global-search-item-snippet">
                    <HighlightedText text={c.quoted_text} query={activeQuery} />
                  </div>
                  <div className="global-search-item-meta">
                    《{c.book_title}》{c.group_name ? ` · ${c.group_name}` : ''} · {c.project_name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && result && result.fulltext.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-title">
                <FileSearch size={13} /> 正文原文（跨全部书籍）
              </div>
              {result.fulltext.map((f, i) => (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  className="global-search-item"
                  onClick={() => {
                    navigate(readerDeepLink(f.book_id, { cfi: f.cfi_anchor, q: activeQuery }))
                    setOpen(false)
                  }}
                >
                  <div className="global-search-item-title global-search-item-snippet">
                    <HighlightedText text={f.snippet} query={activeQuery} />
                  </div>
                  <div className="global-search-item-meta">
                    《{f.book_title}》{f.chapter_title ? ` · ${f.chapter_title}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && query.trim() && (
            <div
              role="button"
              tabIndex={0}
              className="global-search-item global-search-more"
              onClick={() => {
                navigate(`/search?q=${encodeURIComponent(query.trim())}`)
                setOpen(false)
              }}
            >
              在「全库检索」中查看更完整的正文匹配结果 <ArrowRight size={13} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
