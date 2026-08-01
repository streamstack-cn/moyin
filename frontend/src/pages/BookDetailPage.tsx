import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BookOpenText, Download, Edit3, ImageUp, Search, Star, Trash2, Wand2 } from 'lucide-react'
import { api, ApiError, downloadUrl } from '../api/client'
import type { BookDetail, MetadataCandidate, MetadataSearchResponse } from '../api/types'
import Modal from '../components/Modal'
import { useAuth } from '../contexts/AuthContext'
import { formatBadgeClass, formatLabel } from '../lib/bookFormat'

export default function BookDetailPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [book, setBook] = useState<BookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [showMatch, setShowMatch] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    if (!bookId) return
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api.get<BookDetail>(`/api/books/${bookId}`)
      setBook(data)
    } catch (err) {
      setBook(null)
      const msg = err instanceof ApiError ? err.message : '加载失败'
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  if (loading) {
    return (
      <div className="empty-state" style={{ minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!book) {
    return (
      <div className="empty-state" style={{ minHeight: '60vh', gap: 14 }}>
        <div style={{ fontWeight: 600 }}>{loadError || '书籍不存在或无法打开'}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn" onClick={() => navigate('/library')}>
            返回书库
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  async function deleteBook() {
    if (!book || deleting) return
    setDeleting(true)
    try {
      await api.delete(`/api/books/${book.id}`)
      toast.success('已删除书目与本地文件')
      navigate('/library')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
      setDeleting(false)
    }
  }

  async function uploadCover(file: File) {
    setUploadingCover(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.upload(`/api/books/${book!.id}/cover`, formData)
      toast.success('封面已更新')
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '封面上传失败')
    } finally {
      setUploadingCover(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="page-title">书籍详情</div>
      </div>
      <div className="page-content">
        <div className="book-detail">
          <div className="book-detail-aside">
            <div className="book-cover book-detail-cover">
              {book.cover_url ? (
                <img src={book.cover_url} alt={book.title} />
              ) : (
                <div className="book-cover-placeholder">{book.title}</div>
              )}
            </div>
            <div className="book-detail-actions">
              {book.readable ? (
                book.reading_percent > 0 ||
                book.reading_status === 'reading' ||
                book.reading_status === 'finished' ? (
                  <>
                    <button className="btn btn-primary" onClick={() => navigate(`/read/${book.id}`)}>
                      <BookOpenText size={16} />
                      继续阅读{book.reading_percent > 0 ? ` · ${book.reading_percent}%` : ''}
                    </button>
                    <button className="btn" onClick={() => navigate(`/read/${book.id}?restart=1`)}>
                      重新阅读
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary" onClick={() => navigate(`/read/${book.id}`)}>
                    <BookOpenText size={16} />
                    开始阅读
                  </button>
                )
              ) : (
                <div className="badge badge-muted">该格式暂不支持在线阅读</div>
              )}
              <a className="btn" href={downloadUrl(`/api/books/${book.id}/file`)} target="_blank" rel="noreferrer">
                <Download size={16} />
                下载原文件
              </a>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    const res = await api.post<{ is_favorite: boolean }>(`/api/books/${book.id}/favorite`)
                    setBook((prev) => (prev ? { ...prev, is_favorite: res.is_favorite } : prev))
                    toast.success(res.is_favorite ? '已加入收藏' : '已取消收藏')
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : '操作失败')
                  }
                }}
              >
                <Star size={16} fill={book.is_favorite ? 'currentColor' : 'none'} />
                {book.is_favorite ? '取消收藏' : '收藏'}
              </button>
              {user?.role === 'admin' && (
                <>
                  <button className="btn" onClick={() => setShowMatch(true)}>
                    <Wand2 size={16} />
                    匹配豆瓣 / Google 元数据
                  </button>
                  <button className="btn" onClick={() => setShowEdit(true)}>
                    <Edit3 size={16} />
                    手动编辑信息
                  </button>
                  <button className="btn" onClick={() => coverInputRef.current?.click()} disabled={uploadingCover}>
                    <ImageUp size={16} />
                    {uploadingCover ? '上传中…' : '更换封面'}
                  </button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadCover(file)
                      e.target.value = ''
                    }}
                  />
                  <button className="btn btn-danger" onClick={() => setShowDelete(true)}>
                    <Trash2 size={16} />
                    删除书籍
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="book-detail-main">
            <h1 className="book-detail-title">{book.title}</h1>
            {book.subtitle && <div className="book-detail-subtitle">{book.subtitle}</div>}
            <div className="book-detail-authors">
              {book.authors.join('、') || '佚名'}
              {book.translator && ` · ${book.translator} 译`}
            </div>

            <div className="book-detail-badges">
              <span className={formatBadgeClass(book.file_format)}>{formatLabel(book.file_format)}</span>
              {book.metadata_source && <span className="badge badge-muted">来源：{book.metadata_source}</span>}
              {book.tags.map((t) => (
                <span key={t} className="badge badge-muted">
                  {t}
                </span>
              ))}
            </div>

            <div className="card card-pad book-detail-meta">
              <InfoRow label="出版社" value={book.publisher} />
              <InfoRow label="出品方" value={book.producer} />
              <InfoRow label="出版地" value={book.pub_place} />
              <InfoRow label="出版年月" value={book.pub_date} />
              <InfoRow label="ISBN" value={book.isbn} />
              <InfoRow label="丛书" value={book.series} />
              <InfoRow label="页数" value={book.page_count ? String(book.page_count) : ''} />
              <InfoRow label="装帧" value={book.binding} />
              <InfoRow label="定价" value={book.price} />
              <InfoRow label="原作名" value={book.original_title} />
              <InfoRow label="语言" value={book.language} />
            </div>

            {book.description && (
              <div className="card card-pad book-detail-section">
                <div className="book-detail-section-title">内容简介</div>
                <div className="book-detail-desc">{book.description}</div>
              </div>
            )}

            {book.catalog && (
              <div className="card card-pad book-detail-section">
                <div className="book-detail-section-title">目录</div>
                <pre className="book-detail-catalog">{book.catalog}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {showEdit && (
        <EditModal book={book} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load() }} />
      )}
      {showMatch && (
        <MatchModal book={book} onClose={() => setShowMatch(false)} onApplied={() => { setShowMatch(false); load() }} />
      )}
      {showDelete && (
        <Modal title="删除书籍" onClose={() => !deleting && setShowDelete(false)} width={420} closeOnBackdrop={!deleting}>
          <div className="confirm-dialog">
            <div className="confirm-dialog-lead">
              确认删除《<strong>{book.title}</strong>》？
            </div>
            <p className="confirm-dialog-desc">
              将同时删除书库中的本地原文件，以及封面 / 转换副本。此操作不可撤销。
            </p>
            <div className="confirm-dialog-actions">
              <button className="btn" type="button" disabled={deleting} onClick={() => setShowDelete(false)}>
                取消
              </button>
              <button className="btn btn-danger" type="button" disabled={deleting} onClick={deleteBook}>
                <Trash2 size={15} />
                {deleting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="book-info-row">
      <div className="book-info-label">{label}</div>
      <div className="book-info-value">{value}</div>
    </div>
  )
}

function EditModal({ book, onClose, onSaved }: { book: BookDetail; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: book.title,
    subtitle: book.subtitle,
    original_title: book.original_title,
    authors: book.authors.join('、'),
    translator: book.translator,
    publisher: book.publisher,
    producer: book.producer || '',
    pub_place: book.pub_place,
    pub_date: book.pub_date,
    isbn: book.isbn,
    series: book.series,
    page_count: book.page_count,
    binding: book.binding || '',
    price: book.price || '',
    description: book.description,
    catalog: book.catalog || '',
    tags: book.tags.join('、'),
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api.patch(`/api/books/${book.id}`, {
        ...form,
        authors: form.authors.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
        tags: form.tags.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
        page_count: Number(form.page_count) || 0,
      })
      toast.success('已保存')
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="手动编辑书籍信息" onClose={onClose} width={560}>
      <div className="grid-2">
        <Field label="书名" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
        <Field label="副标题" value={form.subtitle} onChange={(v) => setForm({ ...form, subtitle: v })} />
      </div>
      <Field label="作者（用、分隔）" value={form.authors} onChange={(v) => setForm({ ...form, authors: v })} />
      <div className="grid-2">
        <Field label="译者" value={form.translator} onChange={(v) => setForm({ ...form, translator: v })} />
        <Field label="原作名" value={form.original_title} onChange={(v) => setForm({ ...form, original_title: v })} />
      </div>
      <div className="grid-2">
        <Field label="出版地" value={form.pub_place} onChange={(v) => setForm({ ...form, pub_place: v })} placeholder="脚注引用必填" />
        <Field label="出版社" value={form.publisher} onChange={(v) => setForm({ ...form, publisher: v })} />
      </div>
      <div className="grid-2">
        <Field label="出品方" value={form.producer} onChange={(v) => setForm({ ...form, producer: v })} />
        <Field label="装帧" value={form.binding} onChange={(v) => setForm({ ...form, binding: v })} />
      </div>
      <div className="grid-2">
        <Field label="出版年月" value={form.pub_date} onChange={(v) => setForm({ ...form, pub_date: v })} placeholder="如 2010年7月" />
        <Field label="ISBN" value={form.isbn} onChange={(v) => setForm({ ...form, isbn: v })} />
      </div>
      <div className="grid-2">
        <Field label="丛书" value={form.series} onChange={(v) => setForm({ ...form, series: v })} />
        <Field label="页数" value={String(form.page_count)} onChange={(v) => setForm({ ...form, page_count: Number(v) || 0 })} />
      </div>
      <Field label="定价" value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
      <Field label="分类标签（用、分隔）" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
      <div className="field">
        <label>简介</label>
        <textarea className="input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="field">
        <label>目录</label>
        <textarea className="input" rows={6} value={form.catalog} onChange={(e) => setForm({ ...form, catalog: e.target.value })} />
      </div>
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={save} disabled={saving}>
        保存
      </button>
    </Modal>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

type MetaSourceFilter = 'douban' | 'google'

function MatchModal({ book, onClose, onApplied }: { book: BookDetail; onClose: () => void; onApplied: () => void }) {
  const [q, setQ] = useState(book.title)
  const [results, setResults] = useState<MetadataCandidate[]>([])
  const [sourceHints, setSourceHints] = useState<{ douban?: string; google?: string }>({})
  const [sourceFilter, setSourceFilter] = useState<MetaSourceFilter>('douban')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)

  const doubanCount = results.filter((r) => r.source === 'douban').length
  const googleCount = results.filter((r) => r.source === 'google').length
  const filteredResults = results.filter((r) => r.source === sourceFilter)

  const visibleHints = [
    sourceFilter === 'douban' && sourceHints.douban ? sourceHints.douban : '',
    sourceFilter === 'google' && sourceHints.google ? sourceHints.google : '',
  ].filter(Boolean)

  async function doSearch() {
    setLoading(true)
    setSourceHints({})
    try {
      const r = await api.get<MetadataSearchResponse | MetadataCandidate[]>(
        `/api/books/${book.id}/metadata/search?q=${encodeURIComponent(q)}`,
      )
      // 兼容旧版直接返回数组
      if (Array.isArray(r)) {
        setResults(r)
        return
      }
      const list = r.results || []
      setResults(list)
      setSourceHints({
        douban: r.sources?.douban && !r.sources.douban.ok ? r.sources.douban.error || undefined : undefined,
        google: r.sources?.google && !r.sources.google.ok ? r.sources.google.error || undefined : undefined,
      })
      // 当前筛选无结果时，自动切到有结果的来源
      const dCount = list.filter((x) => x.source === 'douban').length
      const gCount = list.filter((x) => x.source === 'google').length
      if (sourceFilter === 'douban' && dCount === 0 && gCount > 0) setSourceFilter('google')
      else if (sourceFilter === 'google' && gCount === 0 && dCount > 0) setSourceFilter('douban')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '搜索失败')
    } finally {
      setLoading(false)
    }
  }

  async function apply(candidate: MetadataCandidate) {
    setApplying(true)
    try {
      const res = await api.post<{ cover_updated?: boolean; cover_warning?: string }>(
        `/api/books/${book.id}/metadata/apply`,
        {
          source: candidate.source,
          source_id: candidate.source === 'douban' ? candidate.douban_id : candidate.google_books_id,
          query_hint: q,
        },
      )
      if (res.cover_warning) toast.warning(res.cover_warning)
      else toast.success(res.cover_updated ? '元数据与封面已更新' : '元数据已更新')
      onApplied()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '应用失败')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal title="匹配在线元数据" onClose={onClose} width={560} closeOnBackdrop={false}>
      <div className="search-bar">
        <label className="search-bar-field">
          <Search size={16} aria-hidden />
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="书名、作者或 ISBN…"
            aria-label="搜索关键词"
          />
        </label>
        <button type="button" className="btn btn-primary search-bar-submit" onClick={doSearch} disabled={loading}>
          {loading ? '搜索中' : '搜索'}
        </button>
      </div>

      <div className="meta-source-filter" role="tablist" aria-label="结果来源">
        {(
          [
            { id: 'douban', label: '豆瓣', count: doubanCount },
            { id: 'google', label: 'Google', count: googleCount },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={sourceFilter === tab.id}
            className={`meta-source-filter-btn${sourceFilter === tab.id ? ' active' : ''}`}
            onClick={() => setSourceFilter(tab.id)}
          >
            {tab.label}
            {results.length > 0 && <span className="meta-source-filter-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {loading && (
        <div className="empty-state">
          <div className="spinner" />
        </div>
      )}
      {!loading && visibleHints.length > 0 && (
        <div className="meta-source-hint">
          {visibleHints.map((h) => (
            <div key={h}>{h}</div>
          ))}
          {visibleHints.some((h) => h.includes('Google')) && (
            <div className="meta-source-hint-sub">可在「管理后台 → 元数据获取」底部配置 Google Books API Key。</div>
          )}
        </div>
      )}
      {!loading &&
        filteredResults.map((r, i) => {
          const metaBits = [
            r.rating ? `${Number(r.rating).toFixed(1)}` : '',
            (r.authors || []).join('、'),
            r.translator || '',
            r.publisher || '',
            r.pub_date || '',
          ].filter(Boolean)
          return (
            <div key={`${r.source}-${r.douban_id || r.google_books_id || i}`} className="citation-item" style={{ alignItems: 'center' }}>
              <div
                style={{
                  width: 40,
                  height: 56,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: 'var(--bg-3)',
                  flexShrink: 0,
                }}
              >
                {r.cover_url && <img src={r.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 2, lineHeight: 1.45 }}>
                  {metaBits.join(' / ')}
                </div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => apply(r)} disabled={applying}>
                采用
              </button>
            </div>
          )
        })}
      {!loading && results.length === 0 && <div className="empty-state">暂无结果，可尝试更换搜索词</div>}
      {!loading && results.length > 0 && filteredResults.length === 0 && (
        <div className="empty-state">当前来源暂无结果，可切换上方筛选</div>
      )}
    </Modal>
  )
}
