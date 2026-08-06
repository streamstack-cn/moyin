import { lazy, Suspense, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { BookDetail } from '../api/types'

const PdfReaderPage = lazy(() => import('./PdfReaderPage'))
const EpubReaderPage = lazy(() => import('./EpubReaderPage'))

function ReaderBootSpinner() {
  return (
    <div className="empty-state" style={{ minHeight: '100vh' }}>
      <div className="spinner" />
    </div>
  )
}

export default function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const [bootBook, setBootBook] = useState<BookDetail | null>(null)
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    api
      .get<BookDetail>(`/api/books/${bookId}`)
      .then((b) => {
        if (!cancelled) setBootBook(b)
      })
      .catch((err) => {
        if (!cancelled) setBootError(err instanceof ApiError ? err.message : '加载书籍失败')
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  if (bootError) {
    return (
      <div className="empty-state" style={{ minHeight: '100vh' }}>
        {bootError}
      </div>
    )
  }
  if (!bootBook) {
    return <ReaderBootSpinner />
  }
  if (bootBook.file_format === 'pdf') {
    return (
      <Suspense fallback={<ReaderBootSpinner />}>
        <PdfReaderPage book={bootBook} />
      </Suspense>
    )
  }
  return (
    <Suspense fallback={<ReaderBootSpinner />}>
      <EpubReaderPage bookId={bookId!} />
    </Suspense>
  )
}
