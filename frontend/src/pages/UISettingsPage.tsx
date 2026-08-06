import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { toast } from 'sonner'
import { BookOpen, Check, KeyRound, Monitor, Palette, Sparkles, Type } from 'lucide-react'
import { api, ApiError } from '../api/client'
import LabSwitch from '../components/LabSwitch'
import { PageSeg, PageSegItem } from '../components/PageSeg'
import { useAuth } from '../contexts/AuthContext'
import {
  useUISettings,
  type ColorSchemeId,
  type FontFamilyId,
} from '../contexts/UISettingsContext'

type Tab = 'scheme' | 'font' | 'features' | 'account'

const TABS: { id: Tab; label: string; shortLabel: string; icon: ReactNode }[] = [
  { id: 'scheme', label: '配色方案', shortLabel: '配色', icon: <Palette size={15} /> },
  { id: 'font', label: '字体选择', shortLabel: '字体', icon: <Type size={15} /> },
  { id: 'features', label: '功能开关', shortLabel: '功能', icon: <Sparkles size={15} /> },
  { id: 'account', label: '账号安全', shortLabel: '账号', icon: <KeyRound size={15} /> },
]

const COLOR_SCHEMES: {
  id: ColorSchemeId
  label: string
  primary: string
  secondary: string
  darkBg: string
  lightBg: string
}[] = [
  {
    id: 'inkwash',
    label: '水墨灰',
    primary: '#a6a29a',
    secondary: '#8a8f8a',
    darkBg: 'linear-gradient(135deg,#13151a,#1a1d24)',
    lightBg: 'linear-gradient(135deg,#f7f4ee,#ebe6dc)',
  },
  {
    id: 'default',
    label: '赤陶暖',
    primary: '#d97757',
    secondary: '#d3a94a',
    darkBg: 'linear-gradient(135deg,#0d0d0e,#141416)',
    lightBg: 'linear-gradient(135deg,#f7f7f9,#ffffff)',
  },
  {
    id: 'ocean',
    label: '深海蓝',
    primary: '#0ea5e9',
    secondary: '#14b8a6',
    darkBg: 'linear-gradient(135deg,#03080f,#000508)',
    lightBg: 'linear-gradient(135deg,#bae6fd,#99f6e4)',
  },
  {
    id: 'forest',
    label: '翡翠绿',
    primary: '#10b981',
    secondary: '#84cc16',
    darkBg: 'linear-gradient(135deg,#020d06,#000a03)',
    lightBg: 'linear-gradient(135deg,#a7f3d0,#d9f99d)',
  },
  {
    id: 'sunset',
    label: '晚霞橙',
    primary: '#f97316',
    secondary: '#ec4899',
    darkBg: 'linear-gradient(135deg,#0d0705,#070304)',
    lightBg: 'linear-gradient(135deg,#fed7aa,#fbcfe8)',
  },
  {
    id: 'sakura',
    label: '樱花粉',
    primary: '#f43f5e',
    secondary: '#a855f7',
    darkBg: 'linear-gradient(135deg,#0d0408,#080206)',
    lightBg: 'linear-gradient(135deg,#fce7f3,#f3e8ff)',
  },
  {
    id: 'arctic',
    label: '冰川蓝',
    primary: '#64748b',
    secondary: '#38bdf8',
    darkBg: 'linear-gradient(135deg,#060810,#030509)',
    lightBg: 'linear-gradient(135deg,#e0f2fe,#f1f5f9)',
  },
  {
    id: 'amber',
    label: '琥珀金',
    primary: '#d97706',
    secondary: '#fb923c',
    darkBg: 'linear-gradient(135deg,#0c0800,#080500)',
    lightBg: 'linear-gradient(135deg,#fef3c7,#ffedd5)',
  },
  {
    id: 'morandi',
    label: '莫兰迪',
    primary: '#8e9ca2',
    secondary: '#bda6a1',
    darkBg: 'linear-gradient(135deg,#1b1d1f,#0f1011)',
    lightBg: 'linear-gradient(135deg,#e4e7e9,#d9d2c5)',
  },
]

const UI_FONT_OPTIONS: {
  id: FontFamilyId
  label: string
  desc: string
  fontFamily: string
}[] = [
  {
    id: 'default',
    label: '系统默认',
    desc: 'Inter / 系统无衬线，界面清晰',
    fontFamily: 'var(--font-sans)',
  },
  {
    id: 'wqy',
    label: '文泉驿正黑',
    desc: '开源中文黑体，兼容性强',
    fontFamily: '"WenQuanYi Zen Hei", "WenQuanYi Micro Hei", "文泉驿正黑", sans-serif',
  },
  {
    id: 'smiley',
    label: '得意黑',
    desc: '活泼斜体，充满设计感',
    fontFamily: '"SmileySans", "PingFang SC", sans-serif',
  },
  {
    id: 'dingtalk',
    label: '钉钉进步',
    desc: '现代商务风，清晰大方',
    fontFamily: '"DingTalkJinBuTi", "PingFang SC", sans-serif',
  },
]

const READER_FONT_OPTIONS: {
  id: FontFamilyId
  label: string
  desc: string
  fontFamily: string
}[] = [
  {
    id: 'default',
    label: '思源宋体',
    desc: 'Noto Serif SC，长文阅读默认',
    fontFamily: '"Noto Serif SC", "PMingLiU", serif',
  },
  {
    id: 'wqy',
    label: '文泉驿正黑',
    desc: '黑体阅读，适合屏幕浏览',
    fontFamily: '"WenQuanYi Zen Hei", "WenQuanYi Micro Hei", sans-serif',
  },
  {
    id: 'smiley',
    label: '得意黑',
    desc: '个性标题与短文气质',
    fontFamily: '"SmileySans", "PingFang SC", sans-serif',
  },
  {
    id: 'dingtalk',
    label: '钉钉进步',
    desc: '现代无衬线，笔记感更强',
    fontFamily: '"DingTalkJinBuTi", "PingFang SC", sans-serif',
  },
]

function SectionTitle({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="ui-settings-section-title">
      <div className="ui-settings-section-title-row">
        <span className="ui-settings-section-icon">{icon}</span>
        <h2>{title}</h2>
      </div>
      <p>{desc}</p>
    </div>
  )
}

function FeatureToggle({
  icon,
  title,
  desc,
  value,
  onChange,
  small,
}: {
  icon: ReactNode
  title: string
  desc: string
  value: boolean
  onChange: (v: boolean) => void
  small?: boolean
}) {
  return (
    <div className={`ui-settings-toggle${small ? ' ui-settings-toggle-small' : ''}`}>
      <div className="ui-settings-toggle-icon">{icon}</div>
      <div className="ui-settings-toggle-text">
        <div className="ui-settings-toggle-title">{title}</div>
        <div className="ui-settings-toggle-desc">{desc}</div>
      </div>
      <LabSwitch checked={value} onChange={onChange} />
    </div>
  )
}

function FontCard({
  option,
  selected,
  onSelect,
  previewZh,
  previewEn,
}: {
  option: { id: FontFamilyId; label: string; desc: string; fontFamily: string }
  selected: boolean
  onSelect: () => void
  previewZh: string
  previewEn: string
}) {
  return (
    <button
      type="button"
      className={`ui-settings-font-card${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <div className="ui-settings-font-card-head">
        <span className="ui-settings-font-dot" />
        <span className="ui-settings-font-label" style={{ fontFamily: option.fontFamily }}>
          {option.label}
        </span>
        {selected && <Check size={16} className="ui-settings-font-check" />}
      </div>
      <div className="ui-settings-font-preview" style={{ fontFamily: option.fontFamily }}>
        <div className="ui-settings-font-preview-zh">{previewZh}</div>
        <div className="ui-settings-font-preview-en">{previewEn}</div>
      </div>
      <div className="ui-settings-font-desc">{option.desc}</div>
    </button>
  )
}

export default function UISettingsPage() {
  const [tab, setTab] = useState<Tab>('scheme')
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const {
    colorScheme,
    uiFont,
    readerFont,
    advancedAnim,
    finishNudge,
    setColorScheme,
    setUiFont,
    setReaderFont,
    setAdvancedAnim,
    setFinishNudge,
  } = useUISettings()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)

  // 管理员改密在管理后台；界面设置仅读者可见
  const visibleTabs = useMemo(
    () => (isAdmin ? TABS.filter((t) => t.id !== 'account') : TABS),
    [isAdmin],
  )

  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4
  const mem =
    typeof navigator !== 'undefined'
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
      : 8
  const isLowEnd = cores <= 4 || mem <= 4

  // 若管理员停在已隐藏的账号页，退回功能开关
  useEffect(() => {
    if (isAdmin && tab === 'account') setTab('features')
  }, [isAdmin, tab])

  async function submitPasswordChange() {
    if (pwdSaving) return
    if (!currentPassword || !newPassword) {
      toast.error('请填写当前密码与新密码')
      return
    }
    if (newPassword.length < 6) {
      toast.error('新密码至少 6 位')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }
    setPwdSaving(true)
    try {
      await api.post('/api/auth/me/password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      toast.success('密码已更新')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '修改密码失败')
    } finally {
      setPwdSaving(false)
    }
  }

  return (
    <>
      <div className="topbar ui-settings-topbar">
        <div className="page-heading">
          <h1 className="page-title">界面设置</h1>
          <p className="page-subtitle">
            配色、字体与动效随账号同步，也会作用于你的登录页；多用户互不干扰
          </p>
        </div>
        <PageSeg className="ui-settings-tabs" aria-label="设置分区" role="tablist">
          {visibleTabs.map((t) => (
            <PageSegItem
              key={t.id}
              icon={t.icon}
              label={t.label}
              shortLabel={t.shortLabel}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
            />
          ))}
        </PageSeg>
      </div>

      <div className="page-content ui-settings-page">
      <div className="ui-settings-panel">
        {tab === 'scheme' && (
          <div className="ui-settings-block">
            <SectionTitle
              icon={<Palette size={18} />}
              title="页面配色方案"
              desc="默认「水墨灰」国风墨韵；深浅色下强调色与环境光会一起变化"
            />
            <div className="ui-settings-scheme-grid">
              {COLOR_SCHEMES.map((s) => {
                const selected = colorScheme === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`ui-settings-scheme-card${selected ? ' selected' : ''}`}
                    style={{ '--scheme-primary': s.primary } as CSSProperties}
                    onClick={() => setColorScheme(s.id)}
                  >
                    <div className="ui-settings-scheme-swatch">
                      <div
                        className="ui-settings-scheme-gradient"
                        style={{ background: `linear-gradient(135deg, ${s.primary}, ${s.secondary})` }}
                      />
                      {selected && <Check size={16} />}
                    </div>
                    <div className="ui-settings-scheme-label">{s.label}</div>
                    <div className="ui-settings-scheme-bars">
                      <span style={{ background: s.primary }} />
                      <span style={{ background: s.secondary }} />
                    </div>
                    <div className="ui-settings-scheme-preview">
                      <div style={{ background: s.darkBg }}>
                        <i style={{ background: s.primary }} />
                      </div>
                      <div style={{ background: s.lightBg }}>
                        <i style={{ background: s.primary }} />
                      </div>
                    </div>
                    <div className="ui-settings-scheme-preview-labels">
                      <span>暗色</span>
                      <span>亮色</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'font' && (
          <div className="ui-settings-block" style={{ gap: 28 }}>
            <div>
              <SectionTitle
                icon={<Monitor size={18} />}
                title="界面字体"
                desc="影响侧栏、按钮、列表等应用界面（不含阅读正文）"
              />
              <div className="ui-settings-font-grid">
                {UI_FONT_OPTIONS.map((f) => (
                  <FontCard
                    key={f.id}
                    option={f}
                    selected={uiFont === f.id}
                    onSelect={() => setUiFont(f.id)}
                    previewZh="墨引 · 阅读与引用"
                    previewEn="MoYin · Reading & Citations"
                  />
                ))}
              </div>
            </div>

            <div>
              <SectionTitle
                icon={<Type size={18} />}
                title="阅读字体"
                desc="影响 EPUB 正文、摘录卡片等阅读排版；与界面字体独立"
              />
              <div className="ui-settings-font-grid">
                {READER_FONT_OPTIONS.map((f) => (
                  <FontCard
                    key={f.id}
                    option={f}
                    selected={readerFont === f.id}
                    onSelect={() => setReaderFont(f.id)}
                    previewZh="读书使人充实，讨论使人机智。"
                    previewEn="Reading makes a full man."
                  />
                ))}
              </div>
            </div>

            <div className="ui-settings-tip">
              字体即时生效并随账号保存。得意黑与钉钉进步体为自定义字体，首次加载可能稍慢。
            </div>
          </div>
        )}

        {tab === 'features' && (
          <div className="ui-settings-block">
            <SectionTitle
              icon={<Sparkles size={18} />}
              title="功能开关"
              desc="控制页面动效、催读提示等；偏好随账号保存，互不影响"
            />

            {advancedAnim && isLowEnd && (
              <div className="ui-settings-perf-hint">
                <div>
                  <div className="ui-settings-perf-title">检测到低性能设备</div>
                  <div className="ui-settings-perf-desc">
                    CPU {cores} 核{mem < 8 ? `，内存约 ${mem}GB` : ''}，建议关闭高级动画
                  </div>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => setAdvancedAnim(false)}>
                  一键关闭
                </button>
              </div>
            )}

            <FeatureToggle
              icon={<Sparkles size={18} />}
              title="页面高级动画"
              desc="路由过渡、侧栏指示器等动效；低性能设备建议关闭"
              value={advancedAnim}
              onChange={setAdvancedAnim}
            />

            <FeatureToggle
              icon={<BookOpen size={18} />}
              title="久未翻开催读提示"
              desc="继续阅读中进度 15%–90%、超过一周未读时，封面轻抖并提示「请读完我」；闲置越久抖动略勤"
              value={finishNudge}
              onChange={setFinishNudge}
            />
          </div>
        )}

        {tab === 'account' && !isAdmin && (
          <div className="ui-settings-block">
            <SectionTitle
              icon={<KeyRound size={18} />}
              title="修改密码"
              desc={`当前账号 ${user?.display_name || user?.username || ''}（读者）可自行更新登录密码`}
            />
            <div className="ui-settings-password-form">
              <label className="ui-settings-password-field">
                <span>当前密码</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label className="ui-settings-password-field">
                <span>新密码</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 6 位"
                />
              </label>
              <label className="ui-settings-password-field">
                <span>确认新密码</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再输入一次"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pwdSaving}
                onClick={() => void submitPasswordChange()}
              >
                {pwdSaving ? '保存中…' : '更新密码'}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </>
  )
}
