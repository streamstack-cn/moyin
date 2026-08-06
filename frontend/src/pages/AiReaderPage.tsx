import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Settings, BookOpen, PenLine, FileText, Bot, Zap, Quote, BrainCircuit, Lightbulb, History, Save, X, RotateCcw, MessageSquare, Sparkles, ChevronDown, ChevronRight, Loader2, Eye, EyeOff, CheckCircle2, Plus, Square,
} from 'lucide-react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getToken } from '../api/client'
import type {
  AiConfig, AiMaterial, AiReport, AiReportContent, AiProvider, AiReaderBook, AiPortrait,
} from '../api/types'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import LabSwitch from '../components/LabSwitch'
import { PageSeg, PageSegItem } from '../components/PageSeg'

// ── 工具 ──────────────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

function coverSrc(url?: string) {
  if (!url) return ''
  return url.startsWith('http') ? url : `${BASE_URL}${url}?_t=${getToken() || ''}`
}

/** 根据 base_url 反查服务商展示名，用于提示"当前保存的 Key 属于哪个服务商" */
function detectProviderName(baseUrl: string | undefined, providerList: AiProvider[]): string {
  if (!baseUrl) return '未知服务商'
  const hit = providerList.find((p) => p.base_url && p.base_url.replace(/\/$/, '') === baseUrl.replace(/\/$/, ''))
  return hit?.name || '未知服务商'
}

const easeOutStr = 'easeOut' as const

/** `/api/ai-reader/providers` 加载完成前的兜底预设，避免设置弹窗刚打开时预设区一片空白 */
const FALLBACK_PROVIDERS: AiProvider[] = [
  { key: 'siliconflow', name: '硅基流动', base_url: 'https://api.siliconflow.cn/v1', has_balance: true, recommended: true, signup_url: '', models: ['Qwen/Qwen3-8B'] },
  { key: 'deepseek', name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', has_balance: true, recommended: true, signup_url: '', models: ['deepseek-chat'] },
  { key: 'kimi', name: 'Kimi', base_url: 'https://api.moonshot.cn/v1', has_balance: true, recommended: false, signup_url: '', models: ['moonshot-v1-8k'] },
  { key: 'qwen', name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', has_balance: false, recommended: false, signup_url: '', models: ['qwen-plus'] },
  { key: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', has_balance: false, recommended: false, signup_url: '', models: ['gpt-4o-mini'] },
  { key: 'gemini', name: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', has_balance: false, recommended: false, signup_url: '', models: ['gemini-2.5-flash'] },
  { key: 'custom', name: '自定义', base_url: '', has_balance: false, recommended: false, signup_url: '', models: [] },
]

/** 部分历史生成结果里嵌套对象用的是英文字段名，展平时翻成中文标签，避免报告里夹杂生硬的英文 key */
const REPORT_FIELD_LABELS: Record<string, string> = {
  insight: '洞察',
  argument: '论证',
  argumentation: '论证',
  reasoning: '论证',
  rationale: '论证',
  my_thought_process: '我的思考',
  my_thoughts: '我的思考',
  thought_process: '我的思考',
  reflection: '反思',
  action: '行动建议',
  question: '疑问',
  summary: '总结',
  quote: '引用',
  evidence: '论据',
  conclusion: '结论',
  point: '要点',
  key_point: '要点',
  example: '举例',
  application: '应用',
  connection: '关联',
  title: '标题',
  content: '内容',
  detail: '细节',
  chapter: '章节',
  suggestion: '建议',
  analysis: '分析',
  observation: '观察',
}

/**
 * 报告各字段理论上是字符串，但部分历史生成结果里 LLM 会返回嵌套对象
 * （例如 { insight, argumentation, reflection }）。这里做兜底展平，
 * 避免 React 直接渲染对象导致整页崩溃，并把英文字段名换成中文标签。
 */
/**
 * 即便提示词已经明确要求只用中文标签，模型偶尔还是会在纯字符串正文里
 * 混入英文字段名当小标题用（比如「要点：…argumentation：…我的思考：…」）。
 * 这里做一次轻量兜底替换，把「行首/换行后紧跟的英文标签 + 冒号」替换成中文，
 * 对已经生成过的历史报告同样生效，不需要重新生成。
 */
function sanitizeReportText(text: string): string {
  const keys = Object.keys(REPORT_FIELD_LABELS).sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(^|[\\n。！？.!?]\\s*)(${keys.join('|')})\\s*[：:]`, 'gi')
  return text.replace(pattern, (_m, pre: string, key: string) => `${pre}${REPORT_FIELD_LABELS[key.toLowerCase()] || key}：`)
}

function renderReportValue(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') return sanitizeReportText(val)
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return val.map((v) => renderReportValue(v)).join('\n\n')
  if (typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${REPORT_FIELD_LABELS[k] || k}：${renderReportValue(v)}`)
      .join('\n')
  }
  return String(val)
}

// ── 微组件：拾取式选中圈（悬浮/追问态一致的克制反馈）────────────────────────

function PickCircle({ checked }: { checked: boolean }) {
  return (
    <span className={`ai-pick-circle${checked ? ' checked' : ''}`} aria-hidden>
      <motion.svg viewBox="0 0 20 20" fill="none">
        <motion.path
          d="M5 10.5l3 3 7-7"
          stroke="#fff"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.24, ease: easeOutStr }}
        />
      </motion.svg>
    </span>
  )
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    reading: { label: '在读', color: 'var(--accent)' },
    finished: { label: '已读', color: 'var(--success)' },
    unread: { label: '未读', color: 'var(--ink-faint)' },
  }
  const s = map[status] || map.unread
  return (
    <span className="ai-status-pill" style={{ color: s.color }}>
      {s.label}
    </span>
  )
}

class AiReaderErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: unknown }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: 'var(--ink)' }}>
          <h3>伴读页面发生错误</h3>
          <pre style={{ fontSize: 12, color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>
            {String((this.state.error as Error)?.stack || this.state.error)}
          </pre>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => this.setState({ hasError: false })}>
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function BookRow({ book, selected, onToggle }: { book: AiReaderBook; selected: boolean; onToggle: () => void }) {
  const totalMaterial = (book.highlight_count || 0) + (book.has_note ? 1 : 0) + (book.citation_count || 0)
  return (
    <motion.button
      type="button"
      layout
      onClick={onToggle}
      whileTap={{ scale: 0.97 }}
      className={`ai-book-row${selected ? ' selected' : ''}`}
    >
      <div className="ai-book-row-cover">
        <img
          src={coverSrc(book.cover_url)}
          alt=""
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      </div>
      <div className="ai-book-row-main">
        <div className="ai-book-row-title">{book.title}</div>
        <div className="ai-book-row-authors">{book.authors?.join('、') || '未知作者'}</div>
        <div className="ai-book-row-meta">
          <StatusPill status={book.reading_status} />
          {totalMaterial > 0 && <span className="ai-book-row-material-badge">{totalMaterial} 条素材</span>}
        </div>
      </div>
      <PickCircle checked={selected} />
    </motion.button>
  )
}

function MaterialPanel({
  materials,
  excludedIds,
  onToggleExclude,
}: {
  materials: AiMaterial[]
  excludedIds: Set<string>
  onToggleExclude: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }))

  if (!materials.length) {
    return (
      <div className="empty-state" style={{ minHeight: 160 }}>
        <FileText size={28} strokeWidth={1.2} />
        <p>选择书籍后显示素材</p>
      </div>
    )
  }

  return (
    <div>
      {materials.map((mat) => {
        const hlCount = Array.isArray(mat?.highlights) ? mat.highlights.length : 0
        const citCount = Array.isArray(mat?.citations) ? mat.citations.length : 0
        const annotationCount = hlCount + (mat?.note_content ? 1 : 0) + citCount
        const open = expanded[mat.id] !== false
        const fmt = (mat.file_format || '').toLowerCase()

        return (
          <div key={mat.id} className="glass-panel ai-material-card">
            <button type="button" className="ai-material-header" onClick={() => toggle(mat.id)}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="ai-material-header-title">《{mat?.title}》</span>
              <div className="ai-material-header-meta">
                {fmt && <span className={`ai-mini-format-tag format-${fmt}`}>{fmt.toUpperCase()}</span>}
                <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontWeight: 400 }}>{annotationCount} 条标注</span>
              </div>
            </button>

            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: easeOutStr }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="ai-material-body">
                    {annotationCount === 0 && <div className="ai-material-empty">暂无高亮 / 笔记 / 引用</div>}

                    {Array.isArray(mat?.highlights) &&
                      mat.highlights.map((h, i) => {
                        if (!h?.id) return null
                        const isExcluded = excludedIds.has(h.id)
                        return (
                          <div key={i} className={`ai-material-item type-highlight${isExcluded ? ' excluded' : ''}`}>
                            <div className="ai-material-item-text">「{h?.text || ''}」</div>
                            {h?.note && (
                              <div className="ai-material-item-note">
                                <PenLine size={12} style={{ marginTop: 2, flexShrink: 0 }} /> <span>{h.note}</span>
                              </div>
                            )}
                            <button type="button" className={`ai-material-item-toggle${isExcluded ? ' is-excluded' : ''}`} onClick={() => onToggleExclude(h.id!)}>
                              {isExcluded ? <RotateCcw size={12} /> : <X size={12} />}
                            </button>
                          </div>
                        )
                      })}

                    {typeof mat?.note_content === 'string' && mat.note_content.trim() && (
                      <div className={`ai-material-item type-note${mat.note_id && excludedIds.has(mat.note_id) ? ' excluded' : ''}`}>
                        <div className="ai-material-item-label">
                          <FileText size={12} /> 读书笔记
                        </div>
                        <div className="ai-material-item-text ai-material-note-md">
                          <ReactMarkdown>
                            {mat.note_content.length > 400 ? `${mat.note_content.slice(0, 400)}…` : mat.note_content}
                          </ReactMarkdown>
                        </div>
                        {mat.note_id && (
                          <button
                            type="button"
                            className={`ai-material-item-toggle${excludedIds.has(mat.note_id) ? ' is-excluded' : ''}`}
                            onClick={() => onToggleExclude(mat.note_id!)}
                          >
                            {excludedIds.has(mat.note_id) ? <RotateCcw size={12} /> : <X size={12} />}
                          </button>
                        )}
                      </div>
                    )}

                    {Array.isArray(mat?.citations) &&
                      mat.citations.map((c, i) => {
                        if (!c?.id) return null
                        const isExcluded = excludedIds.has(c.id)
                        return (
                          <div key={i} className={`ai-material-item type-citation${isExcluded ? ' excluded' : ''}`}>
                            <div className="ai-material-item-text">「{c?.text || ''}」</div>
                            {c?.group && <div className="ai-material-item-group">#{c.group}</div>}
                            <button type="button" className={`ai-material-item-toggle${isExcluded ? ' is-excluded' : ''}`} onClick={() => onToggleExclude(c.id!)}>
                              {isExcluded ? <RotateCcw size={12} /> : <X size={12} />}
                            </button>
                          </div>
                        )
                      })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 生成中不再把原始 SSE/JSON 片段糊一整屏给用户看——那堆带着大括号引号的
 * 半成品文本本身就很吓人，而且流式速度不均匀，体验也不流畅。改成一个
 * 干净的加载动画 + 阶段性文案，字数仍在悄悄增长但只用于内部换算「进度」，
 * 不直接展示原文。
 */
function StreamingText({ chars }: { chars: number }) {
  const stage = chars < 400 ? '正在梳理素材与高亮…' : chars < 1200 ? '正在提炼核心观点…' : '正在组织报告结构…'
  return (
    <div className="ai-generating-anim">
      <div className="ai-generating-orb">
        <span />
        <span />
        <span />
      </div>
      <div className="ai-generating-text">{stage}</div>
      <div className="ai-generating-hint">篇幅较长或选中全文分析时可能需要一点时间，可随时点击「停止生成」</div>
    </div>
  )
}

function ReportView({
  report,
  reportId,
  streaming,
  streamedChars,
  onSaved,
}: {
  report: AiReportContent | null
  reportId: string | null
  streaming: boolean
  streamedChars: number
  onSaved?: (newReport: AiReportContent) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<AiReportContent | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isEditing && report) setEditForm(report)
  }, [report, isEditing])

  if (streaming) {
    return (
      <div className="glass-panel ai-streaming-panel">
        <StreamingText chars={streamedChars} />
      </div>
    )
  }

  if (!report || !editForm) return null

  if (report.raw && !isEditing) {
    return (
      <div className="ai-report-raw-wrap">
        {reportId && (
          <button type="button" className="btn btn-sm ai-report-raw-edit-btn" onClick={() => setIsEditing(true)}>
            <PenLine size={12} /> 编辑
          </button>
        )}
        <div className="glass-panel ai-report-section" style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.9 }}>
          {report.raw}
        </div>
      </div>
    )
  }

  const handleSave = async () => {
    if (!reportId || !editForm) return
    setSaving(true)
    try {
      await api.put(`/api/ai-reader/report/${reportId}`, { report_json: editForm })
      setIsEditing(false)
      onSaved?.(editForm)
    } catch {
      toast.error('保存失败')
    }
    setSaving(false)
  }

  const sections = [
    { key: 'content_summary' as keyof AiReportContent, icon: <BookOpen size={15} />, title: '内容概括' },
    { key: 'core_insights' as keyof AiReportContent, icon: <Zap size={15} />, title: '核心收获' },
    { key: 'personal_reflections' as keyof AiReportContent, icon: <Quote size={15} />, title: '个人思考' },
    { key: 'knowledge_map' as keyof AiReportContent, icon: <BrainCircuit size={15} />, title: '知识关联' },
    { key: 'reading_advice' as keyof AiReportContent, icon: <Lightbulb size={15} />, title: '阅读建议' },
  ]

  return (
    <div>
      {!streaming && reportId && (
        <div className="ai-report-actions">
          {isEditing ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setIsEditing(false)} disabled={saving}>
                取消
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                <Save size={12} /> {saving ? '保存中…' : '保存修改'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => setIsEditing(true)}>
              <PenLine size={12} /> 编辑报告
            </button>
          )}
        </div>
      )}

      {sections.map((s) => {
        const val = renderReportValue(editForm[s.key])
        if (!val && !isEditing) return null
        return (
          <div key={s.key} className="glass-panel ai-report-section">
            <div className="ai-report-section-head">
              {s.icon} {s.title}
            </div>
            {isEditing ? (
              <textarea
                className="ai-report-textarea"
                value={val || ''}
                onChange={(e) => setEditForm({ ...editForm, [s.key]: e.target.value })}
              />
            ) : (
              <div className="ai-report-section-body">{val}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── AI 画像：选择式多选 chip（替代自由输入，用户点选预设标签 + 可添加自定义）──
const READING_STYLE_OPTIONS = ['批判性思维', '第一性原理', '务实落地', '系统思考', '结构化拆解', '类比迁移', '费曼学习法']
const OUTPUT_TONE_OPTIONS = ['客观严谨', '通俗易懂', '尖锐直接', '温和鼓励', '学术严谨', '幽默风趣']
const FOCUS_AREA_OPTIONS = ['商业模式', '心理学', '技术架构', '哲学思辨', '历史脉络', '文学艺术', '个人成长', '科学方法论', '神学与信仰']

function ChipMultiSelect({
  options,
  values,
  onChange,
}: {
  options: string[]
  values: string[]
  onChange: (next: string[]) => void
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const [customInput, setCustomInput] = useState('')

  const toggle = (opt: string) => {
    onChange(values.includes(opt) ? values.filter((v) => v !== opt) : [...values, opt])
  }

  const commitCustom = () => {
    const v = customInput.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setCustomInput('')
    setCustomOpen(false)
  }

  // 用户之前自定义添加、不在预设列表里的标签，也要展示出来（否则选中态会“凭空消失”）
  const customValues = values.filter((v) => !options.includes(v))

  return (
    <div className="ai-chip-select">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`ai-chip-option${values.includes(opt) ? ' selected' : ''}`}
          onClick={() => toggle(opt)}
        >
          {opt}
        </button>
      ))}
      {customValues.map((opt) => (
        <button key={opt} type="button" className="ai-chip-option selected custom" onClick={() => toggle(opt)}>
          {opt}
          <X size={10} />
        </button>
      ))}
      {customOpen ? (
        <input
          autoFocus
          className="ai-chip-custom-input"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onBlur={commitCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitCustom()
            if (e.key === 'Escape') {
              setCustomInput('')
              setCustomOpen(false)
            }
          }}
          placeholder="自定义…回车确认"
        />
      ) : (
        <button type="button" className="ai-chip-option ai-chip-add" onClick={() => setCustomOpen(true)}>
          <Plus size={11} /> 自定义
        </button>
      )}
    </div>
  )
}

function AiSettingsModal({
  config,
  providers,
  onClose,
  onSaved,
}: {
  config: AiConfig | null
  providers: AiProvider[]
  onClose: () => void
  onSaved: () => void
}) {
  const [baseUrl, setBaseUrl] = useState(config?.base_url || 'https://api.siliconflow.cn/v1')
  const [apiKey, setApiKey] = useState(config?.api_key || '')
  const [model, setModel] = useState(config?.model || 'Qwen/Qwen3-8B')
  const [showKey, setShowKey] = useState(false)
  const [outputLang, setOutputLang] = useState(config?.output_lang || 'zh')
  const [outputLength, setOutputLength] = useState(config?.output_length || 'standard')
  const [portrait, setPortrait] = useState<AiPortrait>(
    config?.ai_portrait || { reading_style: '', output_tone: '', focus_areas: [], extra_prompt: '' },
  )
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'config' | 'portrait'>('config')

  const [testStatus, setTestStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; msg: string }>({ type: 'idle', msg: '' })
  const [balance, setBalance] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; msg: string }>({ type: 'idle', msg: '' })
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  // 后端只存了「一份」当前生效的 base_url + key，has_key 是全局标记，不区分服务商。
  // 只有当前选中的 base_url 与已保存的 base_url 完全一致时，"已设置的 Key" 才真的对得上——
  // 否则用户明明切换到了别的服务商（比如 DeepSeek），界面却仍然显示"已设置"，
  // 点测试/查余额时后台用的其实是另一个服务商的 Key，自然会报错，非常误导人。
  const savedKeyMatchesCurrent = Boolean(config?.has_key && baseUrl.replace(/\/$/, '') === (config?.base_url || '').replace(/\/$/, ''))

  const handleFetchModels = async () => {
    if (!baseUrl) {
      toast.error('请先填写 API Base URL')
      return
    }
    if (!apiKey && !savedKeyMatchesCurrent) {
      toast.error('当前服务商还没有保存过 Key，请先填写')
      return
    }
    setFetchingModels(true)
    try {
      const res = await api.get<string[]>(
        `/api/ai-reader/config/models?base_url=${encodeURIComponent(baseUrl)}&api_key=${encodeURIComponent(apiKey)}`,
      )
      setFetchedModels(res)
      if (!res.length) toast.error('未获取到模型列表，服务商可能不支持该接口')
      else toast.success(`已获取 ${res.length} 个可用模型`)
    } catch (e: unknown) {
      toast.error((e as Error)?.message || '获取模型列表失败')
    } finally {
      setFetchingModels(false)
    }
  }

  const handleTest = async () => {
    // apiKey 输入框为空是正常情况（已保存过 Key 时故意不回显明文），
    // 只要当前选中的服务商就是已保存 Key 对应的那个，就应该用已保存的 Key 去测试，
    // 而不是一律拦下来提示"未填写"；但如果切换到了别的服务商，就必须让用户重新填 Key。
    if (!baseUrl || (!apiKey && !savedKeyMatchesCurrent)) {
      toast.error(savedKeyMatchesCurrent ? '请填写完整 API 地址和 Key' : '当前服务商还没有保存过 Key，请先填写')
      return
    }
    setTestStatus({ type: 'loading', msg: '测试中…' })
    try {
      const res = await api.get<{ message: string; model: string }>(
        `/api/ai-reader/config/test?base_url=${encodeURIComponent(baseUrl)}&api_key=${encodeURIComponent(apiKey)}&model=${encodeURIComponent(model)}`,
      )
      setTestStatus({ type: 'success', msg: `连通成功！模型：${res.model}` })
    } catch (e: unknown) {
      setTestStatus({ type: 'error', msg: `连接失败：${(e as Error)?.message || '网络异常'}` })
    }
  }

  const handleCheckBalance = async () => {
    if (!baseUrl || (!apiKey && !savedKeyMatchesCurrent)) {
      toast.error(savedKeyMatchesCurrent ? '请填写完整 API 地址和 Key' : '当前服务商还没有保存过 Key，请先填写')
      return
    }
    setBalance({ type: 'loading', msg: '查询中…' })
    try {
      const res = await api.get<{
        supported: boolean
        message?: string
        currency?: string
        total_balance?: number
        available_balance?: number
      }>(`/api/ai-reader/config/balance?base_url=${encodeURIComponent(baseUrl)}&api_key=${encodeURIComponent(apiKey)}`)
      if (!res.supported) {
        setBalance({ type: 'error', msg: res.message || '该服务商暂不支持余额查询' })
      } else {
        setBalance({
          type: 'success',
          msg: `可用余额：${res.available_balance ?? res.total_balance ?? 0} ${res.currency || ''}`,
        })
      }
    } catch (e: unknown) {
      setBalance({ type: 'error', msg: `查询失败：${(e as Error)?.message || '未知错误'}` })
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.put('/api/ai-reader/config', {
        base_url: baseUrl,
        api_key: apiKey,
        model,
        output_lang: outputLang,
        output_length: outputLength,
      })
      await api.put('/api/ai-reader/portrait', portrait)
      toast.success('AI 配置已保存')
      onSaved()
      onClose()
    } catch (e: unknown) {
      toast.error((e as Error)?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const providerList = providers.length ? providers : FALLBACK_PROVIDERS
  const activeProvider = providerList.find((p) => p.base_url && p.base_url === baseUrl)
  const activeProviderKey = activeProvider?.key
  const activeProviderSignup = activeProvider?.signup_url
  const activeModels = activeProvider?.models || []

  const applyPreset = (provider: AiProvider) => {
    setBaseUrl(provider.base_url)
    if (provider.models.length) setModel(provider.models[0])
    setTestStatus({ type: 'idle', msg: '' })
    setBalance({ type: 'idle', msg: '' })
    setFetchedModels([])
  }

  const displayModels = fetchedModels.length ? fetchedModels : activeModels

  return (
    <Modal title="AI 伴读设置" onClose={onClose} width={640}>
      <div className="ai-settings-tabs">
        {(['config', 'portrait'] as const).map((t) => (
          <button key={t} type="button" className={`ai-settings-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'config' ? '接口配置' : '个性化画像'}
          </button>
        ))}
      </div>

      {tab === 'config' && (
        <div className="ai-settings-body">
          <div className="glass-panel ai-settings-card">
            <div className="ai-settings-field">
              <label>服务商预设</label>
              <div className="ai-preset-grid">
                {providerList.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={`ai-preset-card${activeProviderKey === preset.key ? ' active' : ''}`}
                    onClick={() => applyPreset(preset)}
                  >
                    <span className={`ai-preset-dot provider-${preset.key}`} aria-hidden />
                    <span className="ai-preset-card-name" title={preset.name}>
                      {preset.name}
                    </span>
                    {preset.recommended && <span className="ai-preset-card-tag" title="推荐服务商" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="ai-settings-field">
              <label>API Base URL</label>
              <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.siliconflow.cn/v1" />
            </div>

            <div className="ai-settings-field">
              <label>
                API Key
                {savedKeyMatchesCurrent && (
                  <span className="ai-key-configured-badge">
                    <CheckCircle2 size={11} /> 已设置 {config?.api_key_masked}
                  </span>
                )}
              </label>
              <div className="ai-key-input-wrap">
                <input
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={savedKeyMatchesCurrent ? '留空则不修改已保存的 Key…' : 'sk-…'}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  className="ai-key-input-toggle"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {config?.has_key && !savedKeyMatchesCurrent && (
                <div className="ai-settings-hint ai-settings-hint-warn">
                  当前保存的 Key 属于「{detectProviderName(config?.base_url, providerList)}」，切换到「{activeProvider?.name || '当前服务商'}」后需要重新填写对应的 Key
                </div>
              )}
              {activeProviderSignup && (
                <div className="ai-settings-hint">
                  还没有 Key？
                  <a href={activeProviderSignup} target="_blank" rel="noreferrer">
                    去{activeProvider?.name}获取
                  </a>
                </div>
              )}
            </div>

            <div className="ai-settings-field">
              <label>
                默认模型
                <button
                  type="button"
                  className="ai-fetch-models-btn"
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                >
                  {fetchingModels ? <Loader2 size={11} className="spin" /> : <RotateCcw size={11} />}
                  {fetchingModels ? '获取中…' : '获取实际模型'}
                </button>
              </label>
              {displayModels.length > 0 ? (
                <div className="ai-model-chip-row">
                  {displayModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`ai-model-chip${model === m ? ' active' : ''}`}
                      onClick={() => setModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : null}
              <input
                className="input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="例如：Qwen/Qwen3-8B 或 deepseek-chat"
                style={{ marginTop: displayModels.length ? 8 : 0 }}
              />
              <div className="ai-settings-hint">
                {fetchedModels.length ? '以上为服务商接口实际返回的可用模型。' : '也可直接填入服务商支持的其他模型名称，或点击上方「获取实际模型」拉取服务商真实支持的模型。'}
              </div>
            </div>
          </div>

          <div className="glass-panel ai-settings-card-row" style={{ padding: 20 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <button type="button" className="btn btn-sm" onClick={handleTest} style={{ width: '100%', marginBottom: 8 }}>
                <Zap size={14} /> 测试连通性
              </button>
              {testStatus.type !== 'idle' && <div className={`ai-test-result ${testStatus.type}`}>{testStatus.msg}</div>}
            </div>
            {/* 部分服务商（通义千问 / OpenAI / Gemini / 自定义等）接口本身不支持余额查询，
                与其点了才提示「暂不支持」，不如直接不展示这个按钮，界面更诚实、也更干净 */}
            {(activeProvider?.has_balance ?? true) && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <button type="button" className="btn btn-sm" onClick={handleCheckBalance} style={{ width: '100%', marginBottom: 8 }}>
                  <Zap size={14} /> 查询余额
                </button>
                {balance.type !== 'idle' && <div className={`ai-test-result ${balance.type}`}>{balance.msg}</div>}
              </div>
            )}
          </div>

          <div className="glass-panel ai-settings-card-row" style={{ padding: 20 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>输出语言</label>
              <select className="input" style={{ marginTop: 8 }} value={outputLang} onChange={(e) => setOutputLang(e.target.value)}>
                <option value="zh">简体中文</option>
                <option value="zh-tw">繁体中文</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>报告篇幅</label>
              <select className="input" style={{ marginTop: 8 }} value={outputLength} onChange={(e) => setOutputLength(e.target.value)}>
                <option value="concise">精简凝练</option>
                <option value="standard">标准深度</option>
                <option value="detailed">详尽全面</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {tab === 'portrait' && (
        <div className="ai-settings-body">
          <div className="form-group">
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>阅读偏好风格</label>
            <ChipMultiSelect
              options={READING_STYLE_OPTIONS}
              values={portrait.reading_style ? portrait.reading_style.split('、').map((s) => s.trim()).filter(Boolean) : []}
              onChange={(next) => setPortrait({ ...portrait, reading_style: next.join('、') })}
            />
          </div>
          <div className="form-group">
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>期望输出语气</label>
            <ChipMultiSelect
              options={OUTPUT_TONE_OPTIONS}
              values={portrait.output_tone ? portrait.output_tone.split('、').map((s) => s.trim()).filter(Boolean) : []}
              onChange={(next) => setPortrait({ ...portrait, output_tone: next.join('、') })}
            />
          </div>
          <div className="form-group">
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>重点关注领域</label>
            <ChipMultiSelect
              options={FOCUS_AREA_OPTIONS}
              values={portrait.focus_areas || []}
              onChange={(next) => setPortrait({ ...portrait, focus_areas: next })}
            />
          </div>
          <div className="form-group">
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>其他定制要求</label>
            <textarea
              className="search-input inset-shadow"
              value={portrait.extra_prompt}
              onChange={(e) => setPortrait({ ...portrait, extra_prompt: e.target.value })}
              placeholder="输入额外的 Prompt 指令，在生成报告时会附加给 AI…"
              style={{ minHeight: 100, resize: 'vertical' }}
            />
          </div>
        </div>
      )}

      <div className="ai-settings-footer">
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存设置'}
        </button>
      </div>
    </Modal>
  )
}

function ChatPanel({ bookIds, hasReport }: { bookIds: string[]; hasReport: boolean }) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // block: 'nearest' 只在离它最近的可滚动祖先（聊天消息列表自身）内滚动，
    // 不会像默认的 block: 'start' 那样一路向上传播、把外层页面也带着滚动。
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  async function send(text?: string) {
    const textToSend = (text || input).trim()
    if (!textToSend || sending) return
    const userMsg = { role: 'user', content: textToSend }
    setInput('')
    setMessages((prev) => [...prev, userMsg])
    setSending(true)
    try {
      const res = await api.post<{ content: string }>('/api/ai-reader/chat', {
        book_ids: bookIds,
        messages: [...messages, userMsg],
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.content }])
    } catch (e: unknown) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${(e as Error)?.message || '请求失败'}` }])
    } finally {
      setSending(false)
    }
  }

  if (!hasReport) return null

  const quickPrompts = ['帮我提炼一下核心观点', '书中的结论有何争议？', '根据我的高亮，你觉得我对哪部分最感兴趣？']

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel ai-chat-panel">
      <div className="ai-chat-head">
        <MessageSquare size={14} />
        <span>追问 AI</span>
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 && (
          <div className="ai-chat-empty">
            报告已生成，你可以继续就书本内容向我提问。
            <div className="ai-chat-quick-prompts">
              {quickPrompts.map((p) => (
                <button key={p} type="button" className="ai-chat-quick-prompt" onClick={() => send(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`ai-chat-bubble${m.role === 'user' ? ' user' : ''}`}>
            {m.role === 'assistant' ? (
              <div className="prose prose-sm dark:prose-invert" style={{ maxWidth: 'none', color: 'var(--ink)' }}>
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            ) : (
              <div style={{ color: 'var(--ink)' }}>{m.content}</div>
            )}
          </div>
        ))}
        {sending && (
          <div className="ai-chat-typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="ai-chat-input-row">
        <input
          className="search-input inset-shadow"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send()
          }}
          placeholder="继续提问…"
          style={{ flex: 1, height: 36 }}
        />
        <button type="button" className="btn btn-primary btn-magnetic" onClick={() => send()} disabled={sending || !input.trim()} style={{ height: 36, padding: '0 16px' }}>
          发送
        </button>
      </div>
    </motion.div>
  )
}

export default function AiReaderPageWrapper() {
  return (
    <AiReaderErrorBoundary>
      <AiReaderPage />
    </AiReaderErrorBoundary>
  )
}

function AiReaderPage() {
  const navigate = useNavigate()
  const [books, setBooks] = useState<AiReaderBook[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [materials, setMaterials] = useState<AiMaterial[]>([])
  const [report, setReport] = useState<AiReportContent | null>(null)
  const [reportId, setReportId] = useState<string | null>(null)
  const [reportGenAt, setReportGenAt] = useState<string | null>(null)
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamedChars, setStreamedChars] = useState(0)
  const streamAbortRef = useRef<AbortController | null>(null)
  const [loadingBooks, setLoadingBooks] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyReports, setHistoryReports] = useState<
    { id: string; books: { id: string; title: string; cover: string | null }[]; generated_at: string; book_ids: string[] }[]
  >([])
  const [mobileTab, setMobileTab] = useState<'books' | 'material' | 'report'>('books')
  const [deleteReportId, setDeleteReportId] = useState<string | null>(null)
  const [deletingReport, setDeletingReport] = useState(false)
  const [excludedMaterialIds, setExcludedMaterialIds] = useState<Set<string>>(new Set())
  // 默认关闭：报告应以用户自己的高亮/笔记/引用为主线，全文只在素材不足（<5 条）时
  // 由后端自动少量补充背景。用户主动打开这个开关，才会无条件强塞全文进去。
  const [includeFullText, setIncludeFullText] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')

  const loadConfig = useCallback(async () => {
    try {
      const [cfg, pvds] = await Promise.all([
        api.get<AiConfig>('/api/ai-reader/config'),
        api.get<AiProvider[]>('/api/ai-reader/providers'),
      ])
      setConfig(cfg)
      setProviders(pvds)
    } catch {
      /* 配置未初始化 */
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    setLoadingBooks(true)
    const params = new URLSearchParams()
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    api
      .get<AiReaderBook[]>(`/api/ai-reader/books?${params}`)
      .then(setBooks)
      .finally(() => setLoadingBooks(false))
  }, [searchQuery])

  useEffect(() => {
    const ids = selectedIds.join(',')
    if (!selectedIds.length) {
      setMaterials([])
      setReport(null)
      setReportId(null)
      setReportGenAt(null)
      return
    }
    api.get<AiMaterial[]>(`/api/ai-reader/material?book_ids=${ids}`).then(setMaterials).catch(() => {})
    api
      .get<AiReport | null>(`/api/ai-reader/report?book_ids=${ids}`)
      .then((r) => {
        if (r) {
          setReport(r.report)
          setReportId(r.id)
          setReportGenAt(r.generated_at)
        } else {
          setReport(null)
          setReportId(null)
          setReportGenAt(null)
        }
      })
      .catch(() => {})
  }, [selectedIds])

  async function loadHistory() {
    try {
      const res = await api.get<{ id: string; books: { id: string; title: string; cover: string | null }[]; generated_at: string; book_ids: string[] }[]>(
        '/api/ai-reader/reports',
      )
      setHistoryReports(res)
    } catch {
      /* 忽略 */
    }
  }

  useEffect(() => {
    if (showHistory) loadHistory()
  }, [showHistory])

  async function confirmDeleteHistoryReport() {
    if (!deleteReportId) return
    const id = deleteReportId
    setDeletingReport(true)
    try {
      await api.delete(`/api/ai-reader/report/${id}`)
      setHistoryReports((prev) => prev.filter((r) => r.id !== id))
      if (reportId === id) {
        setReport(null)
        setReportId(null)
        setReportGenAt(null)
      }
      setDeleteReportId(null)
    } catch {
      toast.error('删除失败')
    } finally {
      setDeletingReport(false)
    }
  }

  function toggleBook(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setExcludedMaterialIds(new Set())
  }

  function stopGenerating() {
    streamAbortRef.current?.abort()
  }

  async function generateReport(force = false) {
    if (!selectedIds.length) return
    setStreaming(true)
    setStreamedChars(0)
    setReport(null)
    setMobileTab('report')
    const token = getToken() || ''
    const controller = new AbortController()
    streamAbortRef.current = controller
    try {
      const excludeIds = Array.from(excludedMaterialIds).join(',')
      const params = new URLSearchParams({
        book_ids: selectedIds.join(','),
        force: String(force),
        include_full_text: String(includeFullText),
      })
      if (excludeIds) params.set('exclude_ids', excludeIds)
      const resp = await fetch(`${BASE_URL}/api/ai-reader/generate/stream?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        throw new Error(errText || `生成失败（${resp.status}）`)
      }
      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      // 后端是标准 SSE 格式：一行一个 `data: {...}\n\n`，之前这里直接把整段
      // 原始字节拼成字符串再 JSON.parse，等于拿 "data: {...}\ndata: {...}\n..."
      // 这种事件流语法去当 JSON 解析——必然失败，界面上还会先糊一大坨原始
      // SSE 帧文本，这正是「内容特别多、最后还失败」的根因。这里改成按 SSE
      // 规范逐行解析，只把 content 片段拼成真正的报告文本。
      let buffer = ''
      let reportText = ''
      let sawDone = false
      let streamError: string | null = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const evt of events) {
          const line = evt.trim()
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            sawDone = true
            continue
          }
          try {
            const obj = JSON.parse(payload)
            if (obj.error) {
              streamError = obj.error
              continue
            }
            if (typeof obj.content === 'string') {
              reportText += obj.content
              setStreamedChars(reportText.length)
            }
          } catch {
            /* 单个事件片段解析失败就跳过，不影响整体 */
          }
        }
      }
      if (streamError) throw new Error(streamError)
      if (!sawDone && !reportText) throw new Error('生成中断，未收到完整报告')

      let clean = reportText.trim()
      if (clean.startsWith('```')) {
        clean = clean.split('\n').slice(1).join('\n')
        clean = clean.replace(/```\s*$/, '').trim()
      }
      let parsed: AiReportContent
      try {
        parsed = JSON.parse(clean)
      } catch {
        // 输出被截断等原因导致不是合法 JSON 时，至少把已生成的文字原样展示出来，
        // 而不是直接报错让用户一无所获
        parsed = { raw: reportText } as AiReportContent
      }
      setReport(parsed)
      const r = await api.get<AiReport | null>(`/api/ai-reader/report?book_ids=${selectedIds.join(',')}`)
      if (r) {
        setReport(r.report)
        setReportId(r.id)
        setReportGenAt(r.generated_at)
      }
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') {
        toast('已停止生成')
      } else {
        toast.error((e as Error)?.message || '生成失败')
      }
    } finally {
      setStreaming(false)
      streamAbortRef.current = null
    }
  }

  const hasReport = !!report && !streaming

  return (
    <>
      <div className="topbar ai-reader-topbar">
        <div className="page-heading">
          <div className="page-title-row">
            <Lightbulb size={20} className="page-title-icon" aria-hidden />
            <h1 className="page-title">AI 伴读</h1>
          </div>
          <p className="page-subtitle">基于你的高亮、笔记与引用，生成专属阅读报告并可继续追问</p>
        </div>
        {/* 桌面：设置留在顶栏；移动端改到下方工具条与分区标签对齐 */}
        <PageSeg className="ai-reader-settings-desktop" aria-label="AI 伴读操作">
          <PageSegItem
            icon={<Settings size={14} />}
            label="设置"
            onClick={() => setShowSettings(true)}
          />
        </PageSeg>
      </div>

      <div className="page-content aurora-bg ai-reader-page-content">
        <div className="ai-reader-mobile-toolbar">
          <PageSeg className="ai-reader-mobile-tabs" role="tablist" aria-label="伴读分区">
            <PageSegItem
              role="tab"
              aria-selected={mobileTab === 'books'}
              active={mobileTab === 'books'}
              label="选书"
              onClick={() => setMobileTab('books')}
            />
            <PageSegItem
              role="tab"
              aria-selected={mobileTab === 'material'}
              active={mobileTab === 'material'}
              label="素材"
              onClick={() => setMobileTab('material')}
            />
            <PageSegItem
              role="tab"
              aria-selected={mobileTab === 'report'}
              active={mobileTab === 'report'}
              label="报告"
              onClick={() => setMobileTab('report')}
            />
          </PageSeg>
          <PageSeg className="ai-reader-settings-mobile" aria-label="AI 伴读操作">
            <PageSegItem
              icon={<Settings size={14} />}
              label="设置"
              shortLabel="设置"
              onClick={() => setShowSettings(true)}
            />
          </PageSeg>
        </div>
        <div className="ai-reader-layout">
          {/* 左侧：书籍列表 */}
          <div className={`ai-reader-col-books glass-panel ${mobileTab === 'books' ? 'mobile-visible' : ''}`}>
            <div className="section-title ai-col-section-title">
              <BookOpen size={15} /> 选读资料
            </div>
            <input
              className="search-input ai-book-search"
              placeholder="搜索库中书籍…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="ai-book-list">
              {loadingBooks ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>加载中…</div>
              ) : books.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>无结果</div>
              ) : (
                books.map((b) => <BookRow key={b.id} book={b} selected={selectedIds.includes(b.id)} onToggle={() => toggleBook(b.id)} />)
              )}
            </div>
          </div>

          {/* 中间：书籍素材 */}
          <div className={`ai-reader-col-material glass-panel ${mobileTab === 'material' ? 'mobile-visible' : ''}`}>
            <div className="section-title ai-col-section-title">
              <FileText size={15} /> 关联素材
            </div>
            {!!selectedIds.length && (
              <div className="ai-fulltext-toggle">
                <div>
                  <div className="ai-fulltext-toggle-label">强制附带原文全文</div>
                  <div className="ai-fulltext-toggle-hint">
                    默认关闭：报告以你的高亮/笔记/引用为主，素材不足时才自动补充背景；打开后无论素材多少都会额外附上原文，更慢、更耗 Token
                  </div>
                </div>
                <LabSwitch checked={includeFullText} onChange={setIncludeFullText} />
              </div>
            )}
            <div className="ai-reader-col-scroll">
              <MaterialPanel
                materials={materials}
                excludedIds={excludedMaterialIds}
                onToggleExclude={(id) => {
                  setExcludedMaterialIds((prev) => {
                    const n = new Set(prev)
                    if (n.has(id)) n.delete(id)
                    else n.add(id)
                    return n
                  })
                }}
              />
            </div>
          </div>

          {/* 右侧：生成与报告 */}
          <div className={`ai-reader-col-report glass-panel ${mobileTab === 'report' ? 'mobile-visible' : ''}`}>
            <div className="section-title ai-report-head">
              <div className="ai-report-head-title">
                <Bot size={15} /> <span className="ai-report-head-title-text">伴读助手</span>
                {reportGenAt && (
                  <span className="ai-report-head-time">
                    上次生成 {new Date(reportGenAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="ai-report-head-actions">
                <PageSeg aria-label="报告操作">
                  <PageSegItem
                    icon={<History size={13} />}
                    label="历史"
                    onClick={() => setShowHistory(true)}
                  />
                  {streaming ? (
                    <PageSegItem
                      tone="danger"
                      primary
                      icon={<Square size={12} fill="currentColor" />}
                      label="停止生成"
                      onClick={stopGenerating}
                    />
                  ) : (
                    <PageSegItem
                      primary
                      icon={<Sparkles size={13} />}
                      label="生成伴读报告"
                      onClick={() => generateReport(true)}
                      disabled={!selectedIds.length}
                    />
                  )}
                </PageSeg>
              </div>
            </div>

            <div className="ai-reader-col-scroll">
              {!streaming && !report && !selectedIds.length && (
                <div className="empty-state" style={{ minHeight: 220 }}>
                  <p style={{ marginTop: 8 }}>选择书籍后点击「生成伴读报告」</p>
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>结合高亮、笔记与引用，生成深度阅读报告</p>
                </div>
              )}
              {!streaming && !report && selectedIds.length > 0 && (
                <div className="empty-state" style={{ minHeight: 220 }}>
                  <Sparkles size={36} strokeWidth={1.2} style={{ color: 'var(--accent)' }} />
                  <p style={{ marginTop: 8 }}>点击「生成伴读报告」开始分析</p>
                </div>
              )}

              <ReportView report={report} reportId={reportId} streaming={streaming} streamedChars={streamedChars} onSaved={(r) => setReport(r)} />
              <ChatPanel bookIds={selectedIds} hasReport={hasReport} />
            </div>
          </div>
        </div>
      </div>

      {showHistory && (
        <div className="ai-history-overlay" onClick={() => setShowHistory(false)}>
          <div className="ai-history-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="ai-history-drawer-head">
              <div className="ai-history-drawer-head-title">
                <History size={16} /> 历史阅读报告
              </div>
              <button type="button" className="ai-history-drawer-close" onClick={() => setShowHistory(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="ai-history-drawer-body">
              {historyReports.length === 0 ? (
                <div className="ai-history-empty">暂无历史报告</div>
              ) : (
                historyReports.map((r) => (
                  <div key={r.id} className="ai-history-item">
                    <div className="ai-history-item-books">
                      {r.books.map((b) => (
                        <div key={b.id} className="ai-history-item-book">
                          <button
                            type="button"
                            className="ai-history-item-cover"
                            title={`查看《${b.title}》详情`}
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/books/${b.id}`)
                            }}
                          >
                            {b.cover ? (
                              <img src={coverSrc(b.cover)} alt="" loading="lazy" />
                            ) : (
                              <BookOpen size={12} />
                            )}
                          </button>
                          <span className="ai-history-item-book-title">{b.title}</span>
                        </div>
                      ))}
                    </div>
                    <div className="ai-history-item-date">{new Date(r.generated_at).toLocaleString()}</div>
                    <div className="ai-history-item-actions">
                      <button
                        type="button"
                        className="ai-history-item-view"
                        onClick={() => {
                          setSelectedIds(r.book_ids)
                          setShowHistory(false)
                        }}
                      >
                        查看报告
                      </button>
                      <button type="button" className="ai-history-item-delete" onClick={() => setDeleteReportId(r.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <AiSettingsModal config={config} providers={providers} onClose={() => setShowSettings(false)} onSaved={loadConfig} />
      )}

      {deleteReportId && (
        <ConfirmDialog
          title="删除报告"
          lead="确定删除该阅读报告吗？"
          description="删除后无法恢复，需要重新生成。"
          busy={deletingReport}
          busyLabel="删除中…"
          onClose={() => !deletingReport && setDeleteReportId(null)}
          onConfirm={confirmDeleteHistoryReport}
        />
      )}
    </>
  )
}
