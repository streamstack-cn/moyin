import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import BookDetailPage from './pages/BookDetailPage'
import ReaderPage from './pages/ReaderPage'
import CitationBasketPage from './pages/CitationBasketPage'
import AdminPage from './pages/AdminPage'
import SearchPage from './pages/SearchPage'
import AiReaderPage from './pages/AiReaderPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
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

function RequireAdmin({ children }: { children: React.ReactNode }) {
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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/read/:bookId" element={<RequireAuth><ReaderPage /></RequireAuth>} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/books/:bookId" element={<BookDetailPage />} />
                <Route path="/citation" element={<CitationBasketPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/ai-reader" element={<AiReaderPage />} />
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
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  )
}
