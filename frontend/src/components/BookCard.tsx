import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { BookText, Check, Download, Star } from 'lucide-react'
import { api, ApiError, downloadUrl } from '../api/client'
import type { BookSummary } from '../api/types'
import { formatChipClass, formatLabel } from '../lib/bookFormat'

interface Props {
  book: BookSummary
  onFavoriteChange?: (bookId: string, isFavorite: boolean) => void
  /** 批量选择模式（如缺少信息清理） */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (bookId: string) => void
}

export default function BookCard({ book, onFavoriteChange, selectable, selected, onToggleSelect }: Props) {
  const navigate = useNavigate()
  const [fav, setFav] = useState(!!book.is_favorite)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setFav(!!book.is_favorite)
  }, [book.id, book.is_favorite])

  function openDetail() {
    navigate(`/books/${book.id}`)
  }

  function onCardClick() {
    if (selectable) {
      onToggleSelect?.(book.id)
      return
    }
    openDetail()
  }

  function goDetail(e: MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    openDetail()
  }

  function toggleSelect(e: MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    onToggleSelect?.(book.id)
  }

  async function toggleFavorite(e: MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const prev = fav
    setFav(!prev)
    try {
      const res = await api.post<{ success: boolean; is_favorite: boolean }>(`/api/books/${book.id}/favorite`)
      setFav(res.is_favorite)
      onFavoriteChange?.(book.id, res.is_favorite)
      toast.success(res.is_favorite ? '已加入收藏' : '已取消收藏')
    } catch (err) {
      setFav(prev)
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`book-card${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCardClick()
        }
      }}
    >
      <div className="book-cover">
        {book.cover_url ? (
          <img src={book.cover_url} alt={book.title} loading="lazy" />
        ) : (
          <div className="book-cover-placeholder">
            <BookText size={22} style={{ marginBottom: 8, opacity: 0.6 }} />
            <div>{book.title}</div>
          </div>
        )}
        {selectable && (
          <button
            type="button"
            className={`book-select-check${selected ? ' on' : ''}`}
            title={selected ? '取消勾选' : '勾选'}
            aria-label={selected ? '取消勾选' : '勾选'}
            aria-pressed={!!selected}
            onClick={toggleSelect}
          >
            {selected ? <Check size={14} /> : null}
          </button>
        )}
        {book.reading_status === 'finished' ? (
          <div className="book-finished-badge" title="已读完">
            已读
          </div>
        ) : book.reading_percent > 0 && book.reading_percent < 100 ? (
          <div className="book-progress-bar">
            <div className="book-progress-fill" style={{ width: `${book.reading_percent}%` }} />
          </div>
        ) : null}
        <div className={formatChipClass(book.file_format)} title={`格式：${formatLabel(book.file_format)}`}>
          {formatLabel(book.file_format)}
        </div>
        {selectable ? (
          <button type="button" className="book-detail-btn" title="查看详情" onClick={goDetail}>
            详情
          </button>
        ) : (
          <a
            className="book-download-btn"
            href={downloadUrl(`/api/books/${book.id}/file`)}
            title="下载原文件"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={13} />
          </a>
        )}
        <button
          type="button"
          className={`book-fav-btn${fav ? ' active' : ''}`}
          title={fav ? '取消收藏' : '收藏'}
          aria-label={fav ? '取消收藏' : '收藏'}
          aria-pressed={fav}
          disabled={busy}
          onClick={toggleFavorite}
        >
          <Star size={13} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="book-title">{book.title}</div>
      <div className="book-author">{book.authors.join('、') || '佚名'}</div>
    </div>
  )
}
