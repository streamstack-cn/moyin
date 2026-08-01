import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { LogIn } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { ApiError } from '../api/client'

export default function LoginPage() {
  const { user, login, loading } = useAuth()
  const navigate = useNavigate()
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
    <div className="login-shell">
      <div className="card login-card">
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 700, letterSpacing: '0.04em' }}>
            墨引 MoYin
          </div>
          <div style={{ color: 'var(--ink-faint)', fontSize: 12.5, marginTop: 8 }}>
            电子书阅读 · 标注 · 引用管理系统
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>用户名</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>密码</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} disabled={submitting}>
            <LogIn size={16} />
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 22 }}>
          账号由管理员创建，不支持自助注册
        </div>
      </div>
    </div>
  )
}
