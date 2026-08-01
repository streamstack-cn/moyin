import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

type ThemeMode = 'dark' | 'light'

interface ThemeContextValue {
  theme: ThemeMode
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem('moyin_theme')
  return stored === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const { user, updatePreferences } = useAuth()
  // 记录已应用过账号偏好的用户 id，避免每次渲染都重复覆盖用户本次会话中手动切换的主题
  const appliedForUser = useRef<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('moyin_theme', theme)
  }, [theme])

  // 登录后以账号级偏好为准（跨设备同步），仅在切换到新账号时应用一次
  useEffect(() => {
    if (!user || appliedForUser.current === user.id) return
    appliedForUser.current = user.id
    const remote = user.preferences?.theme
    if (remote === 'light' || remote === 'dark') {
      setTheme(remote)
    }
  }, [user])

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      if (user) void updatePreferences({ theme: next })
      return next
    })
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return ctx
}
