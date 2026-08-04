import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookText, Feather, FileSearch, Highlighter } from 'lucide-react'
import type { GlobalSearchResult } from '../api/types'
import { formatChipClass, formatLabel } from '../lib/bookFormat'
import { HighlightedText } from '../lib/highlightQuery'
import { readerDeepLink } from '../lib/readerDeepLink'

function HitCover({ coverUrl, title }: { coverUrl?: string; title: string }) {
  const letter = (title || '?').trim().slice(0, 1) || '?'
  return (
    <div className="search-page-hit-cover" aria-hidden>
      {coverUrl ? (
        <img src={coverUrl} alt="" loading="lazy" />
      ) : (
        <span className="search-page-hit-cover-fallback">{letter}</span>
      )}
    </div>
  )
}

function HitRow({
  coverUrl,
  bookTitle,
  onClick,
  children,
}: {
  coverUrl?: string
  bookTitle: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="highlight-item card search-page-hit" onClick={onClick}>
      <HitCover coverUrl={coverUrl} title={bookTitle} />
      <div className="search-page-hit-body">{children}</div>
    </button>
  )
}

export default function GlobalSearchResults({
  result,
  activeQuery,
}: {
  result: GlobalSearchResult
  activeQuery: string
}) {
  const navigate = useNavigate()
  const hasHits =
    result.books.length > 0 ||
    result.highlights.length > 0 ||
    result.citations.length > 0 ||
    result.fulltext.length > 0

  if (!hasHits) {
    return <div className="empty-state">没有找到相关内容</div>
  }

  return (
    <div className="home-search-results">
      {result.books.length > 0 && (
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

      {result.highlights.length > 0 && (
        <section className="search-page-group">
          <div className="search-page-group-title">
            <Highlighter size={15} /> 高亮笔记
            <span>{result.highlights.length}</span>
          </div>
          {result.highlights.map((h) => (
            <HitRow
              key={h.id}
              coverUrl={h.cover_url}
              bookTitle={h.book_title}
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
            </HitRow>
          ))}
        </section>
      )}

      {result.citations.length > 0 && (
        <section className="search-page-group">
          <div className="search-page-group-title">
            <Feather size={15} /> 引用篮
            <span>{result.citations.length}</span>
          </div>
          {result.citations.map((c) => (
            <HitRow
              key={c.id}
              coverUrl={c.cover_url}
              bookTitle={c.book_title}
              onClick={() => navigate(`/citation?project=${c.project_id}&item=${c.id}`)}
            >
              <div className="search-page-hit-meta">
                <span>{c.project_name}</span>
                <span>{c.book_title}</span>
              </div>
              <div className="search-page-hit-text">
                <HighlightedText text={c.quoted_text} query={activeQuery} />
              </div>
            </HitRow>
          ))}
        </section>
      )}

      {result.fulltext.length > 0 && (
        <section className="search-page-group">
          <div className="search-page-group-title">
            <FileSearch size={15} /> 正文
            <span>{result.fulltext.length}</span>
          </div>
          {result.fulltext.map((f, i) => (
            <HitRow
              key={`${f.book_id}-${f.cfi_anchor}-${i}`}
              coverUrl={f.cover_url}
              bookTitle={f.book_title}
              onClick={() => navigate(readerDeepLink(f.book_id, { cfi: f.cfi_anchor, q: activeQuery }))}
            >
              <div className="search-page-hit-meta">
                <span>{f.book_title}</span>
                <span>{f.chapter_title}</span>
              </div>
              <div className="search-page-hit-text">
                <HighlightedText text={f.snippet} query={activeQuery} />
              </div>
            </HitRow>
          ))}
        </section>
      )}
    </div>
  )
}
