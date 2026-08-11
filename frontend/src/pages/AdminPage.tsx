import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Database, Download, Edit3, ExternalLink, History, LogOut, Plus, QrCode, RefreshCw, Save, Trash2, Upload, Users, Wand2 } from 'lucide-react'
import { api, ApiError, downloadUrl } from '../api/client'
import type { AdminUser } from '../api/types'
import ConfirmDialog from '../components/ConfirmDialog'
import LabSwitch from '../components/LabSwitch'
import Modal from '../components/Modal'
import { PageSeg, PageSegItem } from '../components/PageSeg'
import { useAuth } from '../contexts/AuthContext'
import { APP_VERSION_LABEL } from '../version'

type Tab = 'users' | 'douban' | 'system' | 'changelog'

interface ChangelogDetail {
  heading: string
  body: string
}

interface ChangelogEntry {
  version: string
  version_label: string
  date: string
  title: string
  highlights: string[]
  details: ChangelogDetail[]
}

interface ChangelogResponse {
  current_version: string
  current_version_label: string
  entries: ChangelogEntry[]
  max_entries: number
}

type DoubanProbeState = 'ok' | 'risk' | 'invalid' | 'pending' | 'none'

interface DoubanStatus {
  enabled: boolean
  cookie_set: boolean
  cookie_ok: boolean
  state?: DoubanProbeState
  message?: string
  user_id: string
  user_name: string
  source?: 'cache' | 'live' | 'none'
  checked_at?: number | null
  probe_age_seconds?: number | null
  auto_match_metadata?: boolean
}

interface SystemStatus {
  database: string
  database_url_masked: string
  redis_configured: boolean
  redis_enabled: boolean
  calibre_available: boolean
  calibre_path?: string
  libreoffice_available: boolean
  libreoffice_path?: string
  pdf_readable?: boolean
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users')

  return (
    <>
      <div className="topbar">
        <div className="page-heading">
          <h1 className="page-title">管理后台</h1>
          <p className="page-subtitle">用户管理 · 元数据获取 · 系统状态 · 版本更新</p>
        </div>
      </div>
      <div className="page-content">
        <PageSeg className="admin-tabs" role="tablist" aria-label="管理后台分区">
          <PageSegItem
            role="tab"
            aria-selected={tab === 'users'}
            active={tab === 'users'}
            onClick={() => setTab('users')}
            icon={<Users size={15} />}
            label="用户管理"
          />
          <PageSegItem
            role="tab"
            aria-selected={tab === 'douban'}
            active={tab === 'douban'}
            onClick={() => setTab('douban')}
            icon={<Wand2 size={15} />}
            label="元数据获取"
          />
          <PageSegItem
            role="tab"
            aria-selected={tab === 'system'}
            active={tab === 'system'}
            onClick={() => setTab('system')}
            icon={<Database size={15} />}
            label="系统状态"
          />
          <PageSegItem
            role="tab"
            aria-selected={tab === 'changelog'}
            active={tab === 'changelog'}
            onClick={() => setTab('changelog')}
            icon={<History size={15} />}
            label="版本更新"
          />
        </PageSeg>

        {tab === 'users' && <UsersPanel />}
        {tab === 'douban' && <DoubanPanel />}
        {tab === 'system' && <SystemPanel />}
        {tab === 'changelog' && <ChangelogPanel />}
      </div>
    </>
  )
}


function UsersPanel() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)
  const [deletingUser, setDeletingUser] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      setUsers(await api.get<AdminUser[]>('/api/admin/users'))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleDisabled(u: AdminUser) {
    try {
      await api.patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled })
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    }
  }

  async function confirmRemoveUser() {
    if (!pendingDelete || deletingUser) return
    setDeletingUser(true)
    try {
      await api.delete(`/api/admin/users/${pendingDelete.id}`)
      setPendingDelete(null)
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setDeletingUser(false)
    }
  }

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <div style={{ fontWeight: 700 }}>账号列表</div>
        <PageSeg aria-label="用户操作">
          <PageSegItem primary icon={<Plus size={14} />} label="新建用户" onClick={() => setShowCreate(true)} />
        </PageSeg>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="spinner" />
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>昵称</th>
              <th>角色</th>
              <th>状态</th>
              <th>最近登录</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>
                  <span className="badge badge-muted">{u.role === 'admin' ? '管理员' : '读者'}</span>
                </td>
                <td>{u.disabled ? <span className="badge" style={{ color: '#e0685a' }}>已禁用</span> : <span className="badge">正常</span>}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '从未登录'}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm" onClick={() => setEditing(u)} title="编辑用户名/密码">
                      <Edit3 size={13} />
                      编辑
                    </button>
                    {u.id !== me?.id && (
                      <>
                        <button className="btn btn-sm" onClick={() => toggleDisabled(u)}>
                          {u.disabled ? '启用' : '禁用'}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(u)}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除用户"
          lead={
            <>
              确认删除用户「<strong>{pendingDelete.username}</strong>」？
            </>
          }
          description="该操作不可恢复。"
          busy={deletingUser}
          busyLabel="删除中…"
          onClose={() => !deletingUser && setPendingDelete(null)}
          onConfirm={confirmRemoveUser}
        />
      )}
    </div>
  )
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'reader'>('reader')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!username || !password) return
    setBusy(true)
    try {
      await api.post('/api/admin/users', { username, password, display_name: displayName, role })
      toast.success('用户已创建')
      onCreated()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="新建用户" onClose={onClose}>
      <div className="field">
        <label>用户名</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="field">
        <label>初始密码</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="field">
        <label>昵称</label>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="field">
        <label>角色</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'reader')}>
          <option value="reader">读者</option>
          <option value="admin">管理员</option>
        </select>
      </div>
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submit} disabled={busy}>
        创建
      </button>
    </Modal>
  )
}

function EditUserModal({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUser
  isSelf: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [username, setUsername] = useState(user.username)
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(user.display_name || '')
  const [role, setRole] = useState<'admin' | 'reader'>(user.role)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!username.trim()) {
      toast.error('用户名不能为空')
      return
    }
    if (password && password.length < 6) {
      toast.error('密码至少 6 位')
      return
    }
    setBusy(true)
    try {
      const body: Record<string, string> = {
        username: username.trim(),
        display_name: displayName,
        role,
      }
      if (password) body.password = password
      await api.patch(`/api/admin/users/${user.id}`, body)
      toast.success(isSelf && (password || username.trim() !== user.username) ? '已更新，若修改了用户名/密码请重新登录' : '用户已更新')
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '更新失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`编辑用户 · ${user.username}`} onClose={onClose}>
      <div className="field">
        <label>用户名</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="field">
        <label>新密码（留空则不修改）</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" />
      </div>
      <div className="field">
        <label>昵称</label>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="field">
        <label>角色</label>
        <select
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'reader')}
          disabled={isSelf}
        >
          <option value="reader">读者</option>
          <option value="admin">管理员</option>
        </select>
        {isSelf && (
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 6 }}>不能取消自己的管理员角色</div>
        )}
      </div>
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submit} disabled={busy}>
        保存修改
      </button>
    </Modal>
  )
}

type QrState = 'idle' | 'waiting' | 'success' | 'expired' | 'error'

function formatProbeAge(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '尚未校验'
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

function doubanStateMeta(state?: DoubanProbeState) {
  switch (state) {
    case 'ok':
      return { label: '可用', tone: 'ok' as const, hint: '登录态正常，可匹配豆瓣元数据' }
    case 'risk':
      return { label: '风控中', tone: 'warn' as const, hint: 'Cookie 已保存，服务器 IP 被豆瓣限制，正在定时复检' }
    case 'pending':
      return { label: '检测中', tone: 'warn' as const, hint: 'Cookie 已保存，正在确认登录态' }
    case 'invalid':
      return { label: '无效', tone: 'bad' as const, hint: 'Cookie 无效或已过期，请重新登录后粘贴' }
    default:
      return { label: '未登录', tone: 'off' as const, hint: '尚未配置豆瓣登录态' }
  }
}

function DoubanPanel() {
  const [status, setStatus] = useState<DoubanStatus | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [cookie, setCookie] = useState('')
  const [autoMatch, setAutoMatch] = useState(true)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showCookieFallback, setShowCookieFallback] = useState(false)

  const [qrState, setQrState] = useState<QrState>('idle')
  const [qrImage, setQrImage] = useState('')
  const [qrError, setQrError] = useState('')
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollDeadlineRef = useRef(0)
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load(opts?: { probe?: boolean }) {
    const force = Boolean(opts?.probe)
    if (force) setProbing(true)
    try {
      const q = force ? '?probe=1' : ''
      const s = await api.get<DoubanStatus>(`/api/douban/status${q}`)
      setStatus(s)
      setEnabled(s.enabled)
      if (typeof s.auto_match_metadata === 'boolean') setAutoMatch(s.auto_match_metadata)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败')
    } finally {
      if (force) setProbing(false)
    }
  }

  useEffect(() => {
    load()
    return () => {
      stopPolling()
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current)
        statusPollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 风控/检测中：前端轻量轮询状态，指示灯会在恢复后变绿
  useEffect(() => {
    const st = status?.state
    const need = Boolean(status?.cookie_set && (st === 'risk' || st === 'pending'))
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current)
      statusPollRef.current = null
    }
    if (!need) return
    statusPollRef.current = setInterval(() => {
      void load()
    }, 30000)
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current)
        statusPollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.state, status?.cookie_set])

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  async function startQrLogin() {
    stopPolling()
    setQrError('')
    setQrState('waiting')
    setQrImage('')
    try {
      const resp = await api.post<{ session_id: string; qrcode_url: string }>('/api/douban/qrcode/start')
      setQrImage(resp.qrcode_url)
      pollDeadlineRef.current = Date.now() + 5 * 60 * 1000
      pollTimerRef.current = setInterval(() => pollQrLogin(resp.session_id), 2000)
    } catch (err) {
      setQrState('error')
      setQrError(err instanceof ApiError ? err.message : '获取二维码失败')
    }
  }

  async function pollQrLogin(sessionId: string) {
    if (Date.now() > pollDeadlineRef.current) {
      stopPolling()
      setQrState('expired')
      return
    }
    try {
      const resp = await api.get<{ status: QrState; user_name?: string; error?: string }>(
        `/api/douban/qrcode/status?session_id=${sessionId}`,
      )
      if (resp.status === 'success') {
        stopPolling()
        setQrState('success')
        toast.success(`豆瓣登录成功${resp.user_name ? `：${resp.user_name}` : ''}`)
        setShowLoginModal(false)
        setShowCookieFallback(false)
        load()
      } else if (resp.status === 'expired') {
        stopPolling()
        setQrState('expired')
      } else if (resp.status === 'error') {
        stopPolling()
        setQrState('error')
        setQrError(resp.error || '登录失败，请改用 Cookie 方式')
      }
    } catch {
      /* 单次失败忽略 */
    }
  }

  function openLoginModal() {
    setShowCookieFallback(false)
    setShowLoginModal(true)
    void startQrLogin()
  }

  function closeLoginModal() {
    setShowLoginModal(false)
    stopPolling()
    setQrState('idle')
    setQrImage('')
    setQrError('')
  }

  /** 在系统默认浏览器中打开豆瓣登录页，便于用户自行复制 Cookie */
  function openDoubanInBrowser() {
    const win = window.open('https://accounts.douban.com/passport/login', '_blank', 'noopener,noreferrer')
    if (!win) {
      toast.error('无法打开浏览器，请手动访问 accounts.douban.com 登录')
      return
    }
    toast.message('已在浏览器打开豆瓣登录页，登录后按下方步骤复制 Cookie')
  }

  function openCookieLogin() {
    closeLoginModal()
    setShowCookieFallback(true)
    openDoubanInBrowser()
  }

  async function save() {
    setSaving(true)
    try {
      await api.post('/api/douban/save_config', {
        DOUBAN_ENABLED: enabled,
        AUTO_MATCH_METADATA: autoMatch,
      })
      toast.success('已保存')
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function confirmBrowserLogin() {
    if (!cookie.trim()) {
      toast.error('请粘贴登录后的完整 Cookie（需含 dbcl2、ck）')
      return
    }
    setSaving(true)
    try {
      const r = await api.post<{
        user_id: string
        user_name: string
        state?: DoubanProbeState
        cookie_ok?: boolean
        message?: string
      }>('/api/douban/login_cookie', {
        DOUBAN_COOKIE: cookie.trim(),
      })
      setCookie('')
      setShowCookieFallback(false)
      setShowLoginModal(false)
      if (r.state === 'ok' || r.cookie_ok) {
        toast.success(`登录成功${r.user_name ? `：${r.user_name}` : ''}`)
      } else if (r.state === 'risk') {
        toast.message(r.message || 'Cookie 已保存，当前处于风控，将自动复检')
      } else {
        toast.message(r.message || 'Cookie 已保存')
      }
      await load({ probe: false })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '登录失败')
    } finally {
      setSaving(false)
    }
  }

  async function logoutDouban() {
    try {
      await api.post('/api/douban/logout', {})
      toast.success('已退出豆瓣登录')
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '退出失败')
    }
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 640 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>元数据获取</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginBottom: 18, lineHeight: 1.7 }}>
        配置豆瓣登录态与 Google Books API，用于匹配书籍封面、作者、页数等信息。豆瓣登录不会保存账号密码。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        豆瓣登录
        {(() => {
          const meta = doubanStateMeta(status?.cookie_set ? status?.state || (status.cookie_ok ? 'ok' : 'none') : 'none')
          return (
            <span className={`douban-status-pill douban-status-${meta.tone}`} title={meta.hint}>
              <span className="douban-status-dot" aria-hidden />
              {meta.label}
            </span>
          )
        })()}
      </div>

      {status?.cookie_set ? (
        <div className="douban-login-card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              {(() => {
                const meta = doubanStateMeta(status.state || (status.cookie_ok ? 'ok' : 'pending'))
                return (
                  <>
                    <div className={`douban-status-title douban-status-${meta.tone}`}>
                      <span className="douban-status-dot" aria-hidden />
                      {meta.label}
                      {status.state === 'ok' ? ' · 登录成功' : ''}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.55 }}>
                      {status.message || meta.hint}
                    </div>
                  </>
                )
              })()}
              <div style={{ fontSize: 13, lineHeight: 1.8, marginTop: 10 }}>
                <div>豆瓣 ID：{status.user_id || '—'}</div>
                <div>昵称：{status.user_name || '—'}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 8 }}>
                上次校验 {formatProbeAge(status.probe_age_seconds)}
                {status.source === 'cache' ? '（缓存）' : status.source === 'live' ? '（实时）' : ''}
                {(status.state === 'risk' || status.state === 'pending') ? ' · 后台每 2 分钟自动复检' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
              <button className="btn" onClick={() => load({ probe: true })} disabled={probing}>
                <RefreshCw size={15} />
                {probing ? '检测中…' : '检测登录态'}
              </button>
              <button className="btn" onClick={logoutDouban}>
                <LogOut size={15} />
                退出登录
              </button>
              {(status.state === 'risk' || status.state === 'invalid' || status.state === 'pending') && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowCookieFallback(true)
                    openDoubanInBrowser()
                  }}
                >
                  更新 Cookie
                </button>
              )}
            </div>
          </div>
          {showCookieFallback && (
            <div className="douban-cookie-fallback" style={{ marginTop: 14 }}>
              <ol className="douban-cookie-steps">
                <li>
                  在浏览器打开豆瓣并完成登录
                  <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={openDoubanInBrowser}>
                    <ExternalLink size={14} />
                    打开豆瓣登录页
                  </button>
                </li>
                <li>
                  按 <kbd>F12</kbd> 打开开发者工具 → <strong>Network</strong>，复制完整 Cookie（须含 <code>dbcl2</code>）
                </li>
              </ol>
              <textarea
                className="input"
                rows={3}
                placeholder="粘贴 Cookie…"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <button type="button" className="btn btn-primary" onClick={confirmBrowserLogin} disabled={saving}>
                保存 Cookie
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="douban-login-stack" style={{ marginBottom: 18 }}>
          <div className="douban-login-row">
            <div className="douban-login-row-text">
              <div className="douban-login-row-title">扫码登录</div>
              <div className="douban-login-row-desc">手机豆瓣 App 扫码，确认后自动完成（推荐）</div>
            </div>
            <button type="button" className="btn btn-primary" onClick={openLoginModal}>
              登录
            </button>
          </div>
          <div className="douban-login-row">
            <div className="douban-login-row-text">
              <div className="douban-login-row-title">Cookie 登录</div>
              <div className="douban-login-row-desc">扫码不可用时，在浏览器登录后粘贴 Cookie；遇风控也会先保存</div>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (showCookieFallback) {
                  setShowCookieFallback(false)
                  return
                }
                setShowCookieFallback(true)
                openDoubanInBrowser()
              }}
            >
              Cookie 登录
            </button>
          </div>

          {showCookieFallback && (
            <div className="douban-cookie-fallback">
              <ol className="douban-cookie-steps">
                <li>
                  在浏览器打开豆瓣并完成登录
                  <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={openDoubanInBrowser}>
                    <ExternalLink size={14} />
                    打开豆瓣登录页
                  </button>
                </li>
                <li>
                  按 <kbd>F12</kbd>（Mac 可用 <kbd>⌥⌘I</kbd>）打开开发者工具，切到 <strong>Network / 网络</strong>
                </li>
                <li>刷新页面，点任意一条请求，在 Request Headers 中找到 <code>Cookie</code></li>
                <li>
                  复制完整 Cookie 粘贴到下方（须含 <code>dbcl2</code>、<code>ck</code>）
                </li>
              </ol>
              <textarea
                className="input"
                rows={3}
                placeholder="粘贴 Cookie…"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <button type="button" className="btn btn-primary" onClick={confirmBrowserLogin} disabled={saving}>
                保存 Cookie
              </button>
            </div>
          )}
        </div>
      )}

      {showLoginModal && (
        <Modal title="登录豆瓣" onClose={closeLoginModal} width={520} closeOnBackdrop={false}>
          <div className="douban-login-popup-body">
            <p className="douban-login-popup-lead">
              请用<strong>手机豆瓣 App</strong>扫描下方二维码，确认后即可登录。
            </p>
            {qrState === 'waiting' && !qrImage && (
              <div className="douban-login-popup-loading">
                <RefreshCw size={18} className="spin" />
                正在获取二维码…
              </div>
            )}
            {qrImage && (qrState === 'waiting' || qrState === 'success') && (
              <div className="douban-login-popup-qr">
                <img src={qrImage} alt="豆瓣登录二维码" />
                <div className="douban-login-popup-hint">等待扫码确认…</div>
              </div>
            )}
            {(qrState === 'expired' || qrState === 'error') && (
              <div className="douban-login-popup-error">
                <div>{qrState === 'expired' ? '二维码已过期' : qrError || '获取二维码失败'}</div>
                <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void startQrLogin()}>
                  <QrCode size={15} />
                  重新获取
                </button>
              </div>
            )}
            <div className="douban-login-popup-alt">
              <button type="button" className="btn btn-sm" onClick={openCookieLogin}>
                <ExternalLink size={14} />
                扫码失败？改用 Cookie 登录
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div className="divider" />

      <div className="settings-switch-group">
        <div className="settings-switch-row">
          <div className="settings-switch-text">
            <div className="settings-switch-title">启用豆瓣元数据抓取</div>
            <div className="settings-switch-desc">关闭后不再向豆瓣请求封面与书目信息</div>
          </div>
          <LabSwitch checked={enabled} onChange={setEnabled} />
        </div>
        <div className="settings-switch-row">
          <div className="settings-switch-text">
            <div className="settings-switch-title">导入新书时自动匹配元数据</div>
            <div className="settings-switch-desc">入库后自动尝试匹配豆瓣 / Google 元数据</div>
          </div>
          <LabSwitch checked={autoMatch} onChange={setAutoMatch} />
        </div>
      </div>
      <button className="btn" onClick={save} disabled={saving}>
        <Save size={15} />
        保存其它配置
      </button>

      <div className="divider" />
      <GoogleBooksPanel />
    </div>
  )
}

function GoogleBooksPanel() {
  const [apiKey, setApiKey] = useState('')
  const [masked, setMasked] = useState('')
  const [keySet, setKeySet] = useState(false)
  const [fromEnv, setFromEnv] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [proxy, setProxy] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [testOk, setTestOk] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .get<{ api_key_set: boolean; api_key_masked: string; from_env: boolean; enabled: boolean; proxy: string }>('/api/settings/google-books')
      .then((r) => {
        setKeySet(r.api_key_set)
        setMasked(r.api_key_masked || '')
        setFromEnv(!!r.from_env)
        setEnabled(r.enabled !== false)  // 默认 true（向下兼容）
        setProxy(r.proxy || '')
      })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      await api.put('/api/settings/google-books', {
        api_key: apiKey.trim(),
        enabled,
        proxy: proxy.trim(),
      })
      setApiKey('')
      toast.success('Google Books 设置已保存')
      // 不重新 fetch，直接用本地 state，避免因远端数据库无该记录时被重置
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function testKey() {
    setTesting(true)
    setTestMsg('')
    setTestOk(null)
    try {
      const r = await api.post<{ ok: boolean; message: string; has_api_key: boolean }>(
        '/api/settings/google-books/test',
        {},
      )
      setTestMsg(r.message || (r.ok ? '可用' : '不可用'))
      setTestOk(r.ok)
      if (r.ok) toast.success(r.message || 'Google Books 可访问')
      else toast.error(r.message || 'Google Books 不可用')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '测试失败'
      setTestMsg(msg)
      setTestOk(false)
      toast.error(msg)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Google Books</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginBottom: 14, lineHeight: 1.6 }}>
        作为豆瓣之外的补充数据源。<strong>若部署环境无法访问 Google（如群晖 NAS），请关闭此开关</strong>，否则每次匹配都会因 Google 超时而阻塞数十秒，影响豆瓣匹配速度。
      </div>

      {/* 启用开关 — 与豆瓣开关样式统一 */}
      <div className="settings-switch-group" style={{ marginBottom: 16 }}>
        <div className="settings-switch-row">
          <div className="settings-switch-text">
            <div className="settings-switch-title">启用 Google Books</div>
            <div className="settings-switch-desc">
              {enabled ? '开启 — 与豆瓣并行搜索' : '已关闭 — 元数据匹配仅走豆瓣，速度最快'}
            </div>
          </div>
          <LabSwitch checked={enabled} onChange={setEnabled} />
        </div>
      </div>

      {enabled && (
        <>
          {/* 代理地址 */}
          <div className="field">
            <label>HTTP 代理（可选）</label>
            <input
              className="input"
              type="text"
              placeholder="http://192.168.1.100:7890 或 socks5://..."
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
            />
            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 4, lineHeight: 1.5 }}>
              部署在无法直连 Google 的环境时填入局域网代理地址。留空则直连。
            </div>
          </div>

          {/* API Key */}
          <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginBottom: 8, lineHeight: 1.5 }}>
            当前 Key：{keySet ? (fromEnv ? '已由部署配置提供' : `已配置（${masked || '****'}）`) : '未配置（匿名配额，不稳定）'}
          </div>
          <div className="field">
            <label>API Key</label>
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder={keySet ? '已配置，留空保存可清除；输入新 Key 覆盖' : '粘贴 Google Books API Key（可选）'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
              <a href="https://developers.google.com/books/docs/v1/using#APIKey" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', textDecoration: 'none' }}>如何获取 API Key？</a>
            </div>
          </div>

          {testMsg ? (
            <div style={{ fontSize: 12.5, marginBottom: 10, color: testOk ? 'var(--success)' : 'var(--danger)', lineHeight: 1.5 }}>{testMsg}</div>
          ) : null}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          <Save size={15} />
          保存设置
        </button>
        {enabled && (
          <button className="btn" onClick={testKey} disabled={testing}>
            <RefreshCw size={15} />
            {testing ? '测试中…' : '测试连通性'}
          </button>
        )}
      </div>
    </div>
  )
}


interface LibraryScanSettings {
  schedule_enabled: boolean
  interval_minutes: number
  watch_debounce_sec: number
  watcher?: { available: boolean; count: number }
  scheduler?: { running: boolean }
}

function SystemPanel() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [repairing, setRepairing] = useState(false)
  const [wheelPageTurn, setWheelPageTurn] = useState(true)
  const [loginCoverFlow, setLoginCoverFlow] = useState(true)
  const [savingReader, setSavingReader] = useState(false)
  const [savingLogin, setSavingLogin] = useState(false)
  const [scanEnabled, setScanEnabled] = useState(false)
  const [scanInterval, setScanInterval] = useState(60)
  const [watchDebounce, setWatchDebounce] = useState(8)
  const [scanMeta, setScanMeta] = useState<LibraryScanSettings | null>(null)
  const [savingScan, setSavingScan] = useState(false)
  const [scanningAll, setScanningAll] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restorePreview, setRestorePreview] = useState<{
    file: File
    type: string
    type_label: string
    app_version?: string
    created_at?: string
  } | null>(null)

  function loadStatus() {
    api.get<SystemStatus>('/api/admin/system').then(setStatus).catch(() => {})
  }

  function loadReaderSettings() {
    api
      .get<{ wheel_page_turn: boolean }>('/api/settings/reader')
      .then((r) => setWheelPageTurn(!!r.wheel_page_turn))
      .catch(() => {})
  }

  function loadLoginSettings() {
    api
      .get<{ login_cover_flow: boolean }>('/api/settings/login')
      .then((r) => setLoginCoverFlow(r.login_cover_flow !== false))
      .catch(() => setLoginCoverFlow(true))
  }

  function loadLibraryScanSettings() {
    api
      .get<LibraryScanSettings>('/api/settings/library-scan')
      .then((r) => {
        setScanEnabled(!!r.schedule_enabled)
        setScanInterval(r.interval_minutes || 60)
        setWatchDebounce(r.watch_debounce_sec || 8)
        setScanMeta(r)
      })
      .catch(() => {})
  }

  useEffect(() => {
    loadStatus()
    loadReaderSettings()
    loadLoginSettings()
    loadLibraryScanSettings()
  }, [])

  async function repairMedia() {
    setRepairing(true)
    try {
      const r = await api.post<{ covers_fixed: number; converted: number }>('/api/admin/repair-media', {})
      toast.success(`已补全封面 ${r.covers_fixed} 本，转换 ${r.converted} 本`)
      loadStatus()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '修复失败')
    } finally {
      setRepairing(false)
    }
  }

  async function saveReaderSettings(next: boolean) {
    setWheelPageTurn(next)
    setSavingReader(true)
    try {
      await api.put('/api/settings/reader', { wheel_page_turn: next })
      toast.success(next ? '已开启滚轮翻页' : '已关闭滚轮翻页')
    } catch (err) {
      setWheelPageTurn(!next)
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSavingReader(false)
    }
  }

  async function saveLoginCoverFlow(next: boolean) {
    setLoginCoverFlow(next)
    setSavingLogin(true)
    try {
      await api.put('/api/settings/login', { login_cover_flow: next })
      toast.success(next ? '已开启登录页封面动态' : '已关闭登录页封面动态')
    } catch (err) {
      setLoginCoverFlow(!next)
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSavingLogin(false)
    }
  }

  async function saveLibraryScanSettings() {
    setSavingScan(true)
    try {
      const r = await api.put<LibraryScanSettings>('/api/settings/library-scan', {
        schedule_enabled: scanEnabled,
        interval_minutes: scanInterval,
        watch_debounce_sec: watchDebounce,
      })
      setScanMeta(r)
      toast.success('书库刷新设置已保存')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSavingScan(false)
    }
  }

  async function scanAllNow() {
    setScanningAll(true)
    try {
      await api.post('/api/libraries/scan-all')
      toast.success('已排队扫描全部书库（后台进行，支持搬家重绑）')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '提交失败')
    } finally {
      setScanningAll(false)
    }
  }

  async function stopScanNow() {
    try {
      await api.post('/api/libraries/scan/stop')
      toast.success('已请求停止扫描')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '停止失败')
    }
  }

  async function disableAllAutoScan() {
    try {
      const res = await api.post<{ disabled_watch_count: number }>('/api/libraries/watch/disable-all')
      setScanEnabled(false)
      toast.success(`已关闭全部自动扫描（${res.disabled_watch_count} 个监控）`)
      const r = await api.get<LibraryScanSettings>('/api/settings/library-scan')
      setScanMeta(r)
      setScanEnabled(Boolean(r.schedule_enabled))
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '关闭失败')
    }
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 640 }}>
      <div style={{ fontWeight: 700, marginBottom: 16 }}>运行环境</div>
      {status && (
        <>
          <InfoLine label="数据库类型" value={status.database === 'sqlite' ? 'SQLite（内置）' : 'PostgreSQL（外挂）'} />
          <InfoLine
            label="Redis 缓存"
            value={
              status.redis_enabled
                ? '已连接'
                : status.redis_configured
                  ? '已配置但连接失败，请检查 Redis 服务'
                  : '未配置（可选，不影响核心功能）'
            }
          />
          <InfoLine
            label="格式转换"
            value={
              status.calibre_available
                ? '可用'
                : '不可用：当前环境未检测到转换工具，部分格式可能无法在线阅读'
            }
          />
          <InfoLine
            label="LibreOffice（可选）"
            value={
              status.libreoffice_available
                ? '可用：支持将脚注转为 Word 真脚注文件'
                : '未安装：日常以引用篮「预览复制」为主；Word 文件导出将降级为编号列表'
            }
          />
          <InfoLine label="PDF 在线阅读" value={status.pdf_readable ? '可用' : '不可用'} />
        </>
      )}

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>阅读器设置</div>
      <div className="settings-switch-group">
        <div className="settings-switch-row">
          <div className="settings-switch-text">
            <div className="settings-switch-title">启用鼠标滚轮上下翻页</div>
            <div className="settings-switch-desc">
              适用于 EPUB / PDF；关闭后避免与页面滚动、触控板手势冲突，对新打开的阅读页立即生效
            </div>
          </div>
          <LabSwitch
            checked={wheelPageTurn}
            disabled={savingReader}
            onChange={(on) => saveReaderSettings(on)}
          />
        </div>
      </div>

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>登录页设置</div>
      <div className="settings-switch-group">
        <div className="settings-switch-row">
          <div className="settings-switch-text">
            <div className="settings-switch-title">登录页封面动态背景</div>
            <div className="settings-switch-desc">
              默认开启；以书库封面横向缓动为登录背景。关闭后显示简洁静态背景（全站生效）
            </div>
          </div>
          <LabSwitch
            checked={loginCoverFlow}
            disabled={savingLogin}
            onChange={(on) => saveLoginCoverFlow(on)}
          />
        </div>
      </div>

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>书库自动刷新</div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.6, marginBottom: 12 }}>
        整理文件后重新扫描可自动认回搬家或改名的书。单个书架可在「书库目录管理」开启监控；此处配置定时全库扫描。
      </p>
      <div className="settings-switch-group">
        <div className="settings-switch-row">
          <div className="settings-switch-text">
            <div className="settings-switch-title">启用定时扫描全部书库</div>
            <div className="settings-switch-desc">按下方间隔自动扫描全部书架</div>
          </div>
          <LabSwitch checked={scanEnabled} onChange={setScanEnabled} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          间隔（分钟）
          <input
            className="input"
            type="number"
            min={5}
            max={1440}
            style={{ width: 88 }}
            value={scanInterval}
            onChange={(e) => setScanInterval(Number(e.target.value) || 60)}
            disabled={!scanEnabled}
          />
        </label>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          监控防抖（秒）
          <input
            className="input"
            type="number"
            min={2}
            max={120}
            style={{ width: 88 }}
            value={watchDebounce}
            onChange={(e) => setWatchDebounce(Number(e.target.value) || 8)}
          />
        </label>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 12 }}>
        监控可用：{scanMeta?.watcher?.available ? '是' : '否'} · 正在监控{' '}
        {scanMeta?.watcher?.count ?? 0} 个书架 · 定时任务：
        {scanMeta?.scheduler?.running ? '运行中' : '未运行'}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={saveLibraryScanSettings} disabled={savingScan}>
          {savingScan ? '保存中…' : '保存刷新设置'}
        </button>
        <button className="btn" onClick={scanAllNow} disabled={scanningAll}>
          {scanningAll ? '提交中…' : '立即扫描全部书库'}
        </button>
        <button className="btn btn-danger" type="button" onClick={stopScanNow}>
          停止扫描
        </button>
        <button className="btn" type="button" onClick={disableAllAutoScan}>
          关闭全部自动扫描
        </button>
      </div>

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>媒体修复</div>
      <p style={{ fontSize: 13, color: 'var(--ink-faint)', marginBottom: 12 }}>
        为缺少封面的书补全封面；对暂不能直接阅读的格式补做转换。
      </p>
      <button className="btn" onClick={repairMedia} disabled={repairing}>
        {repairing ? '修复中…' : '补全封面 / 转换格式'}
      </button>

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>数据备份</div>
      <p style={{ fontSize: 13, color: 'var(--ink-faint)', marginBottom: 12, lineHeight: 1.55 }}>
        配置备份只含账号偏好、AI 配置与系统设置；全部数据备份含数据库与封面等媒体文件。恢复时会自动识别类型。
      </p>
      <div className="backup-actions">
        <a className="btn" href={downloadUrl('/api/admin/backup/config')}>
          <Download size={15} />
          导出配置备份
        </a>
        <a className="btn btn-primary" href={downloadUrl('/api/admin/backup/full')}>
          <Download size={15} />
          导出全部数据备份
        </a>
        <button
          type="button"
          className="btn"
          disabled={restoreBusy}
          onClick={() => restoreInputRef.current?.click()}
        >
          <Upload size={15} />
          {restoreBusy ? '处理中…' : '恢复备份…'}
        </button>
        <input
          ref={restoreInputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setRestoreBusy(true)
            try {
              const fd = new FormData()
              fd.append('file', file)
              const info = await api.upload<{
                type: string
                type_label: string
                app_version?: string
                created_at?: string
              }>('/api/admin/backup/inspect', fd)
              setRestorePreview({
                file,
                type: info.type,
                type_label: info.type_label,
                app_version: info.app_version,
                created_at: info.created_at,
              })
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : '无法识别备份文件')
            } finally {
              setRestoreBusy(false)
            }
          }}
        />
      </div>

      {restorePreview && (
        <ConfirmDialog
          title="确认恢复备份"
          lead={
            <>
              已识别为<strong>{restorePreview.type_label}</strong>
              {restorePreview.app_version ? `（来自 ${restorePreview.app_version}）` : ''}
              。
              {restorePreview.type === 'full'
                ? '全部数据恢复将覆盖当前数据库与媒体文件，请确认已做好准备。'
                : '配置恢复将写回用户偏好、AI 配置与系统设置，不会删除现有书籍。'}
            </>
          }
          description={
            restorePreview.created_at ? `备份时间：${restorePreview.created_at}` : undefined
          }
          confirmLabel={restorePreview.type === 'full' ? '覆盖并恢复' : '恢复配置'}
          busyLabel="恢复中…"
          danger={restorePreview.type === 'full'}
          busy={restoreBusy}
          onClose={() => !restoreBusy && setRestorePreview(null)}
          onConfirm={async () => {
            const file = restorePreview.file
            const kind = restorePreview.type
            setRestoreBusy(true)
            try {
              const fd = new FormData()
              fd.append('file', file)
              const r = await api.upload<{
                success: boolean
                detected_type?: string
                users?: number
                app_config?: number
                message?: string
              }>('/api/admin/backup/restore', fd)
              setRestorePreview(null)
              if (kind === 'full' || r.detected_type === 'full') {
                toast.success(r.message || '全部数据已恢复，页面即将刷新')
                window.setTimeout(() => window.location.reload(), 800)
              } else {
                toast.success(`配置已恢复：用户 ${r.users ?? 0}，系统项 ${r.app_config ?? 0}`)
                loadStatus()
                loadReaderSettings()
                loadLibraryScanSettings()
              }
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : '恢复失败')
            } finally {
              setRestoreBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', padding: '8px 0', fontSize: 13.5, borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 180, color: 'var(--ink-faint)' }}>{label}</div>
      <div>{value}</div>
    </div>
  )
}

function ChangelogPanel() {
  const [data, setData] = useState<ChangelogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  /** 展开的版本键；默认只展开最新一条 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await api.get<ChangelogResponse>('/api/admin/changelog')
        if (cancelled) return
        setData(res)
        const first = res.entries?.[0]
        if (first) {
          setExpanded(new Set([`${first.version_label}-${first.date}-${first.title}`]))
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '加载更新说明失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="card card-pad changelog-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <div style={{ fontWeight: 700 }}>版本更新</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>
          当前 {data?.current_version_label || APP_VERSION_LABEL}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-faint)', fontSize: 13.5 }}>加载中…</div>
      ) : !data?.entries?.length ? (
        <div style={{ color: 'var(--ink-faint)', fontSize: 13.5 }}>暂无更新记录</div>
      ) : (
        <div className="changelog-list">
          {data.entries.map((entry, index) => {
            const key = `${entry.version_label}-${entry.date}-${entry.title}`
            const open = expanded.has(key)
            const isLatest = index === 0
            return (
              <article key={key} className={`changelog-entry${open ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="changelog-entry-toggle"
                  onClick={() => toggle(key)}
                  aria-expanded={open}
                >
                  <span className="changelog-entry-toggle-main">
                    <span className="changelog-version">{entry.version_label || `V${entry.version}`}</span>
                    {isLatest ? <span className="changelog-latest-tag">最新</span> : null}
                    {entry.date ? <time className="changelog-date">{entry.date}</time> : null}
                    {entry.title ? <span className="changelog-title">{entry.title}</span> : null}
                  </span>
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {open && (
                  <div className="changelog-entry-body">
                    {entry.highlights?.length > 0 && (
                      <ul className="changelog-highlights">
                        {entry.highlights.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {entry.details?.length > 0 && (
                      <div className="changelog-details">
                        {entry.details.map((block) => (
                          <section key={block.heading || block.body.slice(0, 24)} className="changelog-detail-block">
                            {block.heading ? <h4>{block.heading}</h4> : null}
                            {block.body ? <p>{block.body}</p> : null}
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
