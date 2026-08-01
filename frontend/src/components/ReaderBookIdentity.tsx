import { Link } from 'react-router-dom'

interface Props {
  bookId?: string
  title?: string
  authors?: string[]
  coverUrl?: string
  loadingTitle?: string
  /** 窄屏只显示封面，避免挤占字号等操作区 */
  coverOnly?: boolean
}

export default function ReaderBookIdentity({
  bookId,
  title,
  authors,
  coverUrl,
  loadingTitle = '正在打开…',
  coverOnly = false,
}: Props) {
  const displayTitle = title?.trim() || loadingTitle
  const authorLine = (authors || []).filter(Boolean).join('、')
  const canOpen = Boolean(bookId)
  const detailTitle = authorLine ? `${displayTitle} · ${authorLine}` : displayTitle

  const inner = (
    <>
      <div className="reader-book-thumb" aria-hidden>
        {coverUrl ? (
          <img src={coverUrl} alt="" loading="lazy" draggable={false} />
        ) : (
          <div className="reader-book-thumb-fallback">
            <span>{displayTitle.slice(0, 1)}</span>
          </div>
        )}
      </div>
      {!coverOnly && (
        <div className="reader-book-meta">
          <div className="reader-book-title">{displayTitle}</div>
          {authorLine ? <div className="reader-book-author">{authorLine}</div> : null}
        </div>
      )}
    </>
  )

  const className = `reader-book-identity${coverOnly ? ' cover-only' : ''}`

  if (!canOpen || !bookId) {
    return (
      <div className={`${className} is-disabled`} aria-disabled="true" title={detailTitle}>
        {inner}
      </div>
    )
  }

  return (
    <Link
      to={`/books/${bookId}`}
      className={className}
      title={`查看详情：${detailTitle}`}
      aria-label={`查看《${displayTitle}》详情`}
      onClick={(e) => {
        e.stopPropagation()
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {inner}
    </Link>
  )
}
