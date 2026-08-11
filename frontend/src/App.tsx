import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, type Location } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import { emitMainResume } from './lib/mainResume'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'

const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const BookDetailPage = lazy(() => import('./pages/BookDetailPage'))
const ReaderPage = lazy(() => import('./pages/ReaderPage'))
const CitationBasketPage = lazy(() => import('./pages/CitationBasketPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AiReaderPage = lazy(() => import('./pages/AiReaderPage'))
const UISettingsPage = lazy(() => import('./pages/UISettingsPage'))

function PageFallback() {
  return (
    <div className="empty-state" style={{ minHeight: '40vh' }}>
      <div className="spinner" />
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="empty-state" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="empty-state" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

function fallbackMainLocation(from: Location): Location {
  return {
    pathname: '/',
    search: '',
    hash: '',
    state: null,
    key: from.key || 'default',
  }
}

/**
 * 阅读页与主界面同壳共存：进入 /read/* 时主界面隐藏但不卸载，
 * 返回时保留滚动位置与页面状态（与顶栏返回按钮一致，避免像整页刷新）。
 */
function AuthenticatedShell() {
  const location = useLocation()
  const isReader = location.pathname.startsWith('/read/')
  const wasReaderRef = useRef(isReader)
  const mainLocationRef = useRef<Location>(
    isReader ? fallbackMainLocation(location) : location,
  )

  if (!isReader) {
    mainLocationRef.current = location
  }

  // 主界面在阅读时不卸载；退出阅读后通知首页 / 引用篮等静默刷新
  useEffect(() => {
    if (wasReaderRef.current && !isReader) {
      emitMainResume()
    }
    wasReaderRef.current = isReader
  }, [isReader])

  const mainLocation = mainLocationRef.current

  return (
    <>
      <div
        className={`app-main-layer${isReader ? ' is-under-reader' : ''}`}
        aria-hidden={isReader}
        inert={isReader ? true : undefined}
      >
        <Layout displayLocation={mainLocation}>
          <Suspense fallback={<PageFallback />}>
            <Routes location={mainLocation}>
              <Route path="/" element={<HomePage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/books/:bookId" element={<BookDetailPage />} />
              <Route path="/citation" element={<CitationBasketPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/ai-reader" element={<AiReaderPage />} />
              <Route path="/ui-settings" element={<UISettingsPage />} />
              <Route
                path="/admin"
                element={
                  <RequireAdmin>
                    <AdminPage />
                  </RequireAdmin>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </div>
      {isReader ? (
        <div className="app-reader-layer">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/read/:bookId" element={<ReaderPage />} />
            </Routes>
          </Suspense>
        </div>
      ) : null}
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AuthenticatedShell />
          </RequireAuth>
        }
      />
    </Routes>
  )
}
