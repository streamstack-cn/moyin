import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from '../api/client'

export interface UserPreferences {
  theme?: 'dark' | 'light'
  reader_theme?: string
  reader_bg_custom?: string
  /** EPUB 字号百分比，如 100 / 120 */
  reader_font_size?: number
  /** PDF 缩放倍率 */
  reader_pdf_scale?: number
  [key: string]: unknown
}

export interface CurrentUser {
  id: string
  username: string
  display_name: string
  role: 'admin' | 'reader'
  preferences: UserPreferences
}

interface AuthContextValue {
  user: CurrentUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  updatePreferences: (partial: UserPreferences) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const bootstrappingRef = useRef(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      bootstrappingRef.current = false
      setLoading(false)
      return
    }
    api
      .get<CurrentUser>('/api/auth/me')
      .then(setUser)
      .catch(() => {
        clearToken()
        setUser(null)
      })
      .finally(() => {
        bootstrappingRef.current = false
        setLoading(false)
      })
  }, [])

  // 会话过期：任意带 token 的 API 返回 401 时清登录态并回登录页
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null)
      // 启动期 /me 的 401 由上面 catch 处理，避免重复跳转闪烁
      if (bootstrappingRef.current) return
      if (window.location.pathname === '/login') return
      navigate('/login', { replace: true })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate])

  const login = useCallback(async (username: string, password: string) => {
    const resp = await api.post<{ token: string; user: CurrentUser }>('/api/auth/login', { username, password })
    setToken(resp.token)
    setUser(resp.user)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  // 账号级偏好（主题、阅读器背景/高亮等）：登录后随账号同步，避免多用户共用同一设备/浏览器时
  // 互相覆盖对方基于 localStorage 的界面设置。乐观更新本地状态，后端保存失败不阻塞交互。
  const updatePreferences = useCallback(async (partial: UserPreferences) => {
    setUser((prev) => (prev ? { ...prev, preferences: { ...prev.preferences, ...partial } } : prev))
    try {
      await api.patch<UserPreferences>('/api/auth/me/preferences', partial)
    } catch {
      // 静默失败：本地状态已乐观更新，下次登录会以后端为准重新拉取
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updatePreferences }}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
