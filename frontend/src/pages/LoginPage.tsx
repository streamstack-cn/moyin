import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import { LogIn } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { ApiError } from '../api/client'
import { easeOutExpo, softSpring } from '../lib/motion'
import { trackGlow } from '../lib/glowTrack'
import { APP_VERSION_LABEL } from '../version'

export default function LoginPage() {
  const { user, login, loading } = useAuth()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '登录失败，请检查用户名或密码')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <motion.div
        className="login-card glass-panel"
        initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.55, ease: easeOutExpo }}
      >
        <div className="login-brand">
          <div className="login-brand-title text-gradient-accent">墨引 MoYin</div>
          <div className="login-brand-subtitle">电子书阅读 · 标注 · 引用</div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label>用户名</label>
            <div className="glow-field" onMouseMove={trackGlow}>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                autoComplete="username"
              />
            </div>
          </div>
          <div className="field login-field-password">
            <label>密码</label>
            <div className="glow-field" onMouseMove={trackGlow}>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>
          <motion.button
            type="submit"
            className="btn btn-primary login-submit"
            disabled={submitting}
            whileHover={reduceMotion ? undefined : { scale: 1.02 }}
            whileTap={reduceMotion ? undefined : { scale: 0.98 }}
            transition={softSpring}
          >
            <LogIn size={18} />
            {submitting ? '登录中…' : '登录'}
          </motion.button>
        </form>

        <div className="login-footer">
          账号由管理员创建，不支持自助注册
          <div className="login-version">{APP_VERSION_LABEL}</div>
        </div>
      </motion.div>
    </div>
  )
}
