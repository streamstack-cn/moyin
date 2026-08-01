import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, BookOpen, Layers, X } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { BookSummary, HomeFeed } from '../api/types'
import BookCard from '../components/BookCard'
import GlobalSearchBar from '../components/GlobalSearchBar'
import { useAuth } from '../contexts/AuthContext'
import { formatChipClass, formatLabel } from '../lib/bookFormat'

interface Stats {
  total_books: number
  finished: number
  reading: number
  finished_this_month: number
  total_highlights: number
  total_citations: number
  missing_douban?: number
  favorites?: number
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 19) return '下午好'
  return '晚上好'
}

export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [feed, setFeed] = useState<HomeFeed | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.get<HomeFeed>('/api/books/home'), api.get<Stats>('/api/admin/stats').catch(() => null)])
      .then(([f, s]) => {
        setFeed(f)
        setStats(s)
      })
      .finally(() => setLoading(false))
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

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">
            {greeting()}
            {user?.display_name ? `，${user.display_name}` : ''}
          </div>
          <div className="page-subtitle">今天也来读一会儿书吧</div>
        </div>
        <button className="btn" onClick={() => navigate('/library')}>
          <Layers size={16} />
          进入书库
        </button>
      </div>

      <div className="page-content">
        <div style={{ marginBottom: 28 }}>
          <GlobalSearchBar />
        </div>

        <div className="stat-strip" aria-label="阅读概览">
          <span className="stat-strip-item">
            <span className="stat-strip-label">馆藏</span>
            <span className="stat-strip-value">{stats?.total_books ?? '—'}</span>
          </span>
          <span className="stat-strip-item">
            <span className="stat-strip-label">在读</span>
            <span className="stat-strip-value">{stats?.reading ?? '—'}</span>
          </span>
          <span className="stat-strip-item">
            <span className="stat-strip-label">本月读完</span>
            <span className="stat-strip-value">{stats?.finished_this_month ?? '—'}</span>
          </span>
          <span className="stat-strip-item">
            <span className="stat-strip-label">高亮</span>
            <span className="stat-strip-value">{stats?.total_highlights ?? '—'}</span>
          </span>
          <button
            type="button"
            className="stat-strip-item clickable"
            onClick={() => navigate('/library?meta=favorited')}
            title="查看我收藏的书（特别好的 / 待看）"
          >
            <span className="stat-strip-label">收藏</span>
            <span className="stat-strip-value">{stats?.favorites ?? '—'}</span>
          </button>
          <button
            type="button"
            className="stat-strip-item clickable"
            onClick={() => navigate('/library?meta=missing_douban')}
            title="查看缺少信息的书，可手动编辑或匹配豆瓣"
          >
            <span className="stat-strip-label">缺少信息</span>
            <span className="stat-strip-value">{stats?.missing_douban ?? '—'}</span>
          </button>
        </div>

        {hasContinue && (
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
                    api.get<Stats>('/api/admin/stats').then(setStats).catch(() => {})
                  }}
                />
              ))}
            </div>
          </section>
        )}

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
                    setStats((prev) =>
                      prev
                        ? {
                            ...prev,
                            favorites: Math.max(0, (prev.favorites ?? 0) + (isFavorite ? 1 : -1)),
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
      </div>
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
