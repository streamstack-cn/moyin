import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Database, Download, Edit3, ExternalLink, LogOut, Plus, QrCode, RefreshCw, Save, Trash2, Users, Wand2 } from 'lucide-react'
import { api, ApiError, downloadUrl } from '../api/client'
import type { AdminUser } from '../api/types'
import Modal from '../components/Modal'
import { useAuth } from '../contexts/AuthContext'

type Tab = 'users' | 'douban' | 'system'

interface DoubanStatus {
  enabled: boolean
  cookie_set: boolean
  cookie_ok: boolean
  user_id: string
  user_name: string
  source?: 'cache' | 'live' | 'none'
  checked_at?: number | null
  probe_age_seconds?: number | null
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
        <div>
          <div className="page-title">管理后台</div>
          <div className="page-subtitle">用户管理 · 元数据获取 · 系统状态</div>
        </div>
      </div>
      <div className="page-content">
        <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
          <TabBtn active={tab === 'users'} onClick={() => setTab('users')} icon={<Users size={15} />} label="用户管理" />
          <TabBtn active={tab === 'douban'} onClick={() => setTab('douban')} icon={<Wand2 size={15} />} label="元数据获取" />
          <TabBtn active={tab === 'system'} onClick={() => setTab('system')} icon={<Database size={15} />} label="系统状态" />
        </div>

        {tab === 'users' && <UsersPanel />}
        {tab === 'douban' && <DoubanPanel />}
        {tab === 'system' && <SystemPanel />}
      </div>
    </>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={`btn ${active ? 'btn-primary' : ''}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

function UsersPanel() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
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

  async function removeUser(u: AdminUser) {
    if (!confirm(`确认删除用户「${u.username}」？`)) return
    try {
      await api.delete(`/api/admin/users/${u.id}`)
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontWeight: 700 }}>账号列表</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} />
          新建用户
        </button>
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
                        <button className="btn btn-sm btn-danger" onClick={() => removeUser(u)}>
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

function DoubanPanel() {
  const [status, setStatus] = useState<DoubanStatus | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [cookie, setCookie] = useState('')
  const [autoMatch, setAutoMatch] = useState(true)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)

  const [qrState, setQrState] = useState<QrState>('idle')
  const [qrImage, setQrImage] = useState('')
  const [qrError, setQrError] = useState('')
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollDeadlineRef = useRef(0)

  async function load(opts?: { probe?: boolean }) {
    const force = Boolean(opts?.probe)
    if (force) setProbing(true)
    try {
      const q = force ? '?probe=1' : ''
      const s = await api.get<DoubanStatus>(`/api/douban/status${q}`)
      setStatus(s)
      setEnabled(s.enabled)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载失败')
    } finally {
      if (force) setProbing(false)
    }
  }

  useEffect(() => {
    // 默认读缓存登录态，不每次进页都打豆瓣探活
    load()
    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    try {
      const resp = await api.post<{ session_id: string; qrcode_url: string }>('/api/douban/qrcode/start')
      setQrImage(resp.qrcode_url)
      // 与后端会话 TTL（5 分钟）保持一致，避免二维码过期后仍在无意义轮询
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
        toast.success(`豆瓣扫码登录成功${resp.user_name ? `：${resp.user_name}` : ''}`)
        load()
      } else if (resp.status === 'expired') {
        stopPolling()
        setQrState('expired')
      } else if (resp.status === 'error') {
        stopPolling()
        setQrState('error')
        setQrError(resp.error || '登录失败，请改用 Cookie 方式')
      }
      // status === 'waiting' 时保持轮询，不做处理
    } catch {
      // 单次轮询失败不中断，等待下一次定时器触发
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.post('/api/douban/save_config', {
        DOUBAN_ENABLED: enabled,
        ...(cookie ? { DOUBAN_COOKIE: cookie } : {}),
        AUTO_MATCH_METADATA: autoMatch,
      })
      toast.success('已保存')
      setCookie('')
      load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function openDoubanLoginPage() {
    window.open('https://accounts.douban.com/passport/login', '_blank', 'noopener,noreferrer')
  }

  async function confirmBrowserLogin() {
    if (!cookie.trim()) {
      toast.error('请先在豆瓣登录页登录，再把 Cookie 粘贴到下方')
      return
    }
    setSaving(true)
    try {
      const r = await api.post<{ user_id: string; user_name: string }>('/api/douban/login_cookie', {
        DOUBAN_COOKIE: cookie.trim(),
      })
      toast.success(`Login Success：${r.user_name || r.user_id}`)
      setCookie('')
      load()
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
        配置豆瓣登录态与 Google Books API，用于匹配书籍封面、作者、页数等信息。
        豆瓣登录不会保存账号密码；扫码或粘贴 Cookie 均可。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>豆瓣登录</div>

      {status?.cookie_ok ? (
        <div className="douban-login-card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--success, #4caf50)' }}>Login Success</div>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                <div>DoubanID：{status.user_id || '—'}</div>
                <div>Nickname：{status.user_name || '—'}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 8 }}>
                登录态已缓存；上次校验 {formatProbeAge(status.probe_age_seconds)}
                {status.source === 'cache' ? '（本地缓存）' : status.source === 'live' ? '（实时探活）' : ''}。
                超过约 30 分钟会在后台自动保活，无需每次进页刷新。
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
              <button className="btn" onClick={() => load({ probe: true })} disabled={probing}>
                <RefreshCw size={15} />
                {probing ? '检测中…' : '检测登录态'}
              </button>
              <button className="btn" onClick={logoutDouban}>
                <LogOut size={15} />
                Logout
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="douban-login-card" style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Login</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button className="btn btn-primary" onClick={openDoubanLoginPage}>
              <ExternalLink size={15} />
              打开豆瓣登录页
            </button>
          </div>
          <ol style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.8, paddingLeft: 18, margin: '0 0 12px' }}>
            <li>在新打开的豆瓣登录页完成账号登录</li>
            <li>打开开发者工具 → Network，刷新页面，点开任意 douban.com 请求</li>
            <li>复制 Request Headers 中的 Cookie，粘贴到下方并确认</li>
          </ol>
          <textarea
            className="input"
            rows={3}
            placeholder="粘贴登录后的 Cookie…"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <button className="btn btn-primary" onClick={confirmBrowserLogin} disabled={saving}>
            确认登录
          </button>
        </div>
      )}

      <div className="field">
        <label>备选：扫码登录</label>
        {qrState === 'idle' && (
          <button className="btn" onClick={startQrLogin}>
            <QrCode size={15} />
            生成登录二维码
          </button>
        )}
        {qrState === 'waiting' && qrImage && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <img
              src={qrImage}
              alt="豆瓣登录二维码"
              style={{
                width: 160,
                height: 160,
                borderRadius: 8,
                background: '#fff',
                padding: 8,
                border: '1px solid var(--border)',
                objectFit: 'contain',
              }}
            />
            <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.8, minWidth: 180 }}>
              用手机豆瓣 App 扫码确认后，本页会自动保存登录态。
              {qrImage.startsWith('http') && (
                <div style={{ marginTop: 6, color: 'var(--danger)' }}>
                  若二维码仍无法显示，请改用上方 Cookie 登录。
                </div>
              )}
            </div>
          </div>
        )}
        {qrState === 'success' && <div style={{ fontSize: 12.5, color: 'var(--success, #4caf50)' }}>扫码登录成功</div>}
        {(qrState === 'expired' || qrState === 'error') && (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--danger)', marginBottom: 8 }}>
              {qrState === 'expired' ? '二维码已过期，请重新生成' : qrError || '扫码登录失败'}
            </div>
            <button className="btn" onClick={startQrLogin}>
              <QrCode size={15} />
              重新生成二维码
            </button>
          </div>
        )}
      </div>

      <div className="divider" />

      <div className="field">
        <label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用豆瓣元数据抓取
        </label>
      </div>
      <div className="field">
        <label>
          <input type="checkbox" checked={autoMatch} onChange={(e) => setAutoMatch(e.target.checked)} /> 导入新书时自动匹配元数据
        </label>
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
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .get<{ api_key_set: boolean; api_key_masked: string; from_env: boolean }>('/api/settings/google-books')
      .then((r) => {
        setKeySet(r.api_key_set)
        setMasked(r.api_key_masked || '')
        setFromEnv(!!r.from_env)
      })
      .catch(() => {})
  }, [])

  async function saveKey() {
    setSaving(true)
    try {
      const r = await api.put<{ success: boolean; api_key_set: boolean }>('/api/settings/google-books', {
        api_key: apiKey.trim(),
      })
      setKeySet(r.api_key_set)
      setApiKey('')
      toast.success(apiKey.trim() ? 'Google Books API Key 已保存' : '已清除数据库中的 API Key')
      const status = await api.get<{ api_key_set: boolean; api_key_masked: string; from_env: boolean }>(
        '/api/settings/google-books',
      )
      setKeySet(status.api_key_set)
      setMasked(status.api_key_masked || '')
      setFromEnv(!!status.from_env)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Google Books</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-faint)', marginBottom: 12, lineHeight: 1.5 }}>
        无 API Key 时匿名配额极易触发 429，匹配结果会只剩豆瓣。可在
        <a
          href="https://console.cloud.google.com/apis/library/books.googleapis.com"
          target="_blank"
          rel="noreferrer"
          style={{ margin: '0 4px' }}
        >
          Google Cloud
        </a>
        启用 Books API 并创建密钥后填入下方（也可设置环境变量 <code>GOOGLE_BOOKS_API_KEY</code>）。
      </div>
      <div style={{ fontSize: 12.5, marginBottom: 10, color: keySet ? 'var(--accent-strong, #1a73e8)' : 'var(--ink-faint)' }}>
        当前状态：{keySet ? (fromEnv ? '已由环境变量提供' : `已配置（${masked || '****'}）`) : '未配置'}
      </div>
      <div className="field">
        <label>API Key</label>
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder={keySet ? '已配置，留空保存可清除；输入新 Key 覆盖' : '粘贴 Google Books API Key'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <button className="btn btn-primary" onClick={saveKey} disabled={saving}>
        <Save size={15} />
        保存 Google API Key
      </button>
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
  const [savingReader, setSavingReader] = useState(false)
  const [scanEnabled, setScanEnabled] = useState(false)
  const [scanInterval, setScanInterval] = useState(60)
  const [watchDebounce, setWatchDebounce] = useState(8)
  const [scanMeta, setScanMeta] = useState<LibraryScanSettings | null>(null)
  const [savingScan, setSavingScan] = useState(false)
  const [scanningAll, setScanningAll] = useState(false)

  function loadStatus() {
    api.get<SystemStatus>('/api/admin/system').then(setStatus).catch(() => {})
  }

  function loadReaderSettings() {
    api
      .get<{ wheel_page_turn: boolean }>('/api/settings/reader')
      .then((r) => setWheelPageTurn(!!r.wheel_page_turn))
      .catch(() => {})
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
                ? '已连接（元数据缓存 / 登录限流 / 扫码会话生效中）'
                : status.redis_configured
                  ? '已配置但连接失败，请检查 REDIS_URL'
                  : '未配置（可选，不影响核心功能）'
            }
          />
          <InfoLine
            label="Calibre 格式转换"
            value={
              status.calibre_available
                ? `可用${status.calibre_path ? `（${status.calibre_path}）` : ''}`
                : '不可用：请安装 Calibre，并确保 ebook-convert 在 PATH 中（macOS: brew install --cask calibre）'
            }
          />
          <InfoLine
            label="LibreOffice 真脚注导出"
            value={
              status.libreoffice_available
                ? `可用${status.libreoffice_path ? `（${status.libreoffice_path}）` : ''}`
                : '不可用：请安装 LibreOffice（macOS: brew install --cask libreoffice），脚注将降级为编号列表'
            }
          />
          <InfoLine label="PDF 在线阅读" value={status.pdf_readable ? '可用（pdf.js 原生渲染，无需转换）' : '不可用'} />
        </>
      )}

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>阅读器设置</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={wheelPageTurn}
          disabled={savingReader}
          onChange={(e) => saveReaderSettings(e.target.checked)}
        />
        启用鼠标滚轮上下翻页（EPUB / PDF）
      </label>
      <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.6, margin: 0 }}>
        关闭后阅读页滚轮不再翻页，避免与页面滚动/触控板手势冲突。修改后对新打开的阅读页立即生效。
      </p>

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>书库自动刷新</div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', lineHeight: 1.6, marginBottom: 12 }}>
        整理目录时文件搬家/改名后，扫描会按文件内容指纹重绑路径。单个书架可在「书库目录管理」开启「监控」；
        此处配置全局定时全库扫描。
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, marginBottom: 10 }}>
        <input type="checkbox" checked={scanEnabled} onChange={(e) => setScanEnabled(e.target.checked)} />
        启用定时扫描全部书库
      </label>
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
        为已入库但缺少封面的书籍（尤其是 PDF）补抽封面；对 MOBI/AZW3 等补做 EPUB 转换以便在线阅读。
      </p>
      <button className="btn" onClick={repairMedia} disabled={repairing}>
        {repairing ? '修复中…' : '补全封面 / 转换格式'}
      </button>

      <div className="divider" />
      <div style={{ fontWeight: 700, marginBottom: 10 }}>数据备份</div>
      <a className="btn" href={downloadUrl('/api/admin/backup')}>
        <Download size={15} />
        导出数据备份（zip）
      </a>
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
