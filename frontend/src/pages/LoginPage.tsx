import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import LoginCoverMarquee from '../components/LoginCoverMarquee'
import LabSwitch from '../components/LabSwitch'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useUISettings } from '../contexts/UISettingsContext'
import { api, ApiError } from '../api/client'
import { loginThemeStyle } from '../lib/colorSchemes'

const REMEMBER_KEY = 'moyin_remember_me'

type FlyButtonStyle = CSSProperties & { '--fly-x'?: string }

function readRememberPreference(): boolean {
  const v = localStorage.getItem(REMEMBER_KEY)
  if (v === null) return true
  return v !== 'false'
}

export default function LoginPage() {
  const { user, login, loading } = useAuth()
  const { theme } = useTheme()
  const ui = useUISettings()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [rememberMe, setRememberMe] = useState(readRememberPreference)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 配色/字体仍用 UISettings；封面动态为站点级设置（默认开，仅管理员可关）
  const schemeForStyle = ui.colorScheme
  const fontForStyle = ui.uiFont
  const [showCoverFlow, setShowCoverFlow] = useState(true)
  const themeForStyle = theme

  const themeStyle = useMemo(
    () => loginThemeStyle(schemeForStyle, fontForStyle, themeForStyle),
    [schemeForStyle, fontForStyle, themeForStyle],
  )

  useEffect(() => {
    let cancelled = false
    api
      .get<{ login_cover_flow: boolean }>('/api/settings/login')
      .then((r) => {
        if (!cancelled) setShowCoverFlow(r.login_cover_flow !== false)
      })
      .catch(() => {
        if (!cancelled) setShowCoverFlow(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overflow
    const prevBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtml
      body.style.overflow = prevBody
    }
  }, [])

  if (!loading && user) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setSubmitting(true)
    setError('')
    try {
      localStorage.setItem(REMEMBER_KEY, String(rememberMe))
      await login(username.trim(), password, rememberMe)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请检查用户名或密码')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = Boolean(username.trim() && password) && !submitting

  return (
    <div
      className={`login-page login-dialog-root${showCoverFlow ? ' has-cover-flow' : ''}`}
      data-login-scheme={schemeForStyle}
      data-login-font={fontForStyle}
      style={themeStyle}
    >
      <LoginCoverMarquee enabled={showCoverFlow} />

      <div className={`login-card${reduceMotion ? '' : ' login-card-enter'}`}>
        <div className="login-card-shine" aria-hidden />

        <div className="login-card-inner">
          <div className="login-brand">
            <div className="login-brand-row" aria-label="墨引 MoYin">
              <div className="login-brand-zh">
                {'墨引'.split('').map((ch, i) => (
                  <span
                    key={`zh-${i}`}
                    className="login-brand-digit text-gradient-accent"
                    style={{ animationDelay: reduceMotion ? '0s' : `${i * 0.1}s` }}
                  >
                    {ch}
                  </span>
                ))}
              </div>
              <span className={`login-brand-en text-gradient-accent${reduceMotion ? '' : ' login-brand-en-enter'}`}>
                MoYin
              </span>
            </div>
            <div className="login-brand-subtitle">电子书阅读 · 标注 · 引用</div>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <form id="login-form" onSubmit={handleSubmit} className="login-form">
            <div className="login-form-control">
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  if (error) setError('')
                }}
                autoComplete="username"
                autoFocus
                required
              />
              <label>
                {'用户名'.split('').map((ch, i) => (
                  <span key={i} style={{ transitionDelay: `${i * 40}ms` }}>
                    {ch}
                  </span>
                ))}
              </label>
            </div>

            <div className="login-form-control has-toggle">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (error) setError('')
                }}
                autoComplete="current-password"
                required
              />
              <label>
                {'密码'.split('').map((ch, i) => (
                  <span key={i} style={{ transitionDelay: `${i * 40}ms` }}>
                    {ch}
                  </span>
                ))}
              </label>
              <button
                type="button"
                className="login-pw-toggle"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? '隐藏密码' : '显示密码'}
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="login-remember">
              <span>保持登录</span>
              <LabSwitch
                checked={rememberMe}
                onChange={(v) => {
                  setRememberMe(v)
                  localStorage.setItem(REMEMBER_KEY, String(v))
                }}
              />
            </div>
          </form>

          <button
            type="submit"
            form="login-form"
            className="fly-btn fly-btn--primary login-fly-submit"
            disabled={!canSubmit}
            style={
              {
                opacity: canSubmit ? 1 : 0.5,
                '--fly-x': '1.35em',
              } as FlyButtonStyle
            }
          >
            <span className="fly-icon">
              {submitting ? <Loader2 size={20} className="spin" /> : <LogIn size={22} />}
            </span>
            <span className="fly-label">{submitting ? '验证中' : '登 录'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
