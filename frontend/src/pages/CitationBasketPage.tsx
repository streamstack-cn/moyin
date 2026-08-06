import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  Plus,
  Trash2,
} from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { CitationItem, CitationProject } from '../api/types'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import { PageSeg, PageSegItem } from '../components/PageSeg'
import { copyTextToClipboard } from '../lib/clipboard'
import { onMainResume } from '../lib/mainResume'

interface PreviewFootnote {
  order: number
  text: string
  quoted_text: string
}
interface PreviewBibliography {
  text: string
  stroke_estimated: boolean
}

const UNGROUPED = '__ungrouped__'

export default function CitationBasketPage() {
  const [searchParams] = useSearchParams()
  const [projects, setProjects] = useState<CitationProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string>(() => searchParams.get('project') || '')
  const [items, setItems] = useState<CitationItem[]>([])
  const [groupOptions, setGroupOptions] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [variant, setVariant] = useState<'simplified' | 'traditional'>('simplified')
  const [footnotes, setFootnotes] = useState<PreviewFootnote[]>([])
  const [bibliography, setBibliography] = useState<PreviewBibliography[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<CitationProject | null>(null)
  const [deletingProject, setDeletingProject] = useState(false)
  const [loading, setLoading] = useState(true)

  async function copyText(label: string, text: string) {
    if (!text.trim()) {
      toast.error(`${label}为空`)
      return
    }
    const ok = await copyTextToClipboard(text)
    if (ok) toast.success(`${label}已复制`)
    else toast.error('复制失败，请长按选中文本后使用系统复制')
  }

  function pickDefaultProjectId(rows: CitationProject[]): string {
    return rows.find((x) => x.name === '默认引用篮')?.id || rows[0]?.id || ''
  }

  async function loadProjects() {
    const p = await api.get<CitationProject[]>('/api/citation/projects')
    setProjects(p)
    if (p.length === 0) {
      setActiveProjectId('')
      return p
    }
    if (!activeProjectId || !p.some((x) => x.id === activeProjectId)) {
      setActiveProjectId(pickDefaultProjectId(p))
    }
    return p
  }

  function askDeleteProject(id: string) {
    const target = projects.find((p) => p.id === id)
    if (!target || deletingProject) return
    setPendingDelete(target)
  }

  async function confirmDeleteProject() {
    if (!pendingDelete || deletingProject) return
    const id = pendingDelete.id
    setDeletingProject(true)
    try {
      await api.delete(`/api/citation/projects/${id}`)
      toast.success('引用篮已删除')
      setPendingDelete(null)
      const rows = await loadProjects()
      if (activeProjectId === id) {
        setActiveProjectId(pickDefaultProjectId(rows))
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setDeletingProject(false)
    }
  }

  useEffect(() => {
    loadProjects().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return onMainResume(() => {
      void loadProjects().then(() => {
        if (activeProjectId) {
          void loadItems()
          void loadPreview()
          void loadGroupOptions()
        }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId])

  useEffect(() => {
    if (!activeProjectId) return
    loadItems()
    loadPreview()
    loadGroupOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, variant])

  // 当前篮条目增减时，同步标签上的数量
  useEffect(() => {
    if (!activeProjectId) return
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProjectId ? { ...p, item_count: items.length } : p)),
    )
  }, [activeProjectId, items.length])

  useEffect(() => {
    const targetId = searchParams.get('item')
    if (!targetId || items.length === 0) return
    const el = document.getElementById(`citation-item-${targetId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('citation-item-flash')
    const timer = setTimeout(() => el.classList.remove('citation-item-flash'), 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  async function loadItems() {
    try {
      const rows = await api.get<CitationItem[]>(`/api/citation/projects/${activeProjectId}/items`)
      setItems(rows)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '加载引用篮失败')
    }
  }

  async function loadGroupOptions() {
    try {
      const rows = await api.get<string[]>(`/api/citation/projects/${activeProjectId}/groups`)
      setGroupOptions(rows)
    } catch {
      setGroupOptions([])
    }
  }

  async function loadPreview() {
    try {
      const data = await api.get<{ footnotes: PreviewFootnote[]; bibliography: PreviewBibliography[] }>(
        `/api/citation/projects/${activeProjectId}/preview?variant=${variant}`,
      )
      setFootnotes(data.footnotes)
      setBibliography(data.bibliography)
    } catch {
      setFootnotes([])
      setBibliography([])
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, CitationItem[]>()
    for (const item of items) {
      const key = item.group_name || UNGROUPED
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    const named = [...map.entries()].filter(([k]) => k !== UNGROUPED)
    const ungrouped = map.get(UNGROUPED)
    const result = named
    if (ungrouped) result.push([UNGROUPED, ungrouped])
    return result
  }, [items])

  async function persistOrderFromGroups(groupList: [string, CitationItem[]][]) {
    const flatIds = groupList.flatMap(([, its]) => its.map((i) => i.id))
    await api.post(`/api/citation/projects/${activeProjectId}/reorder`, { item_ids: flatIds })
  }

  function moveWithinGroup(groupKey: string, index: number, dir: -1 | 1) {
    const current = groups.map(([k, its]) => [k, [...its]] as [string, CitationItem[]])
    const bucket = current.find(([k]) => k === groupKey)
    if (!bucket) return
    const arr = bucket[1]
    const target = index + dir
    if (target < 0 || target >= arr.length) return
    ;[arr[index], arr[target]] = [arr[target], arr[index]]
    const flat = current.flatMap(([, its]) => its)
    setItems(flat)
    persistOrderFromGroups(current).then(loadPreview)
  }

  async function removeItem(id: string) {
    await api.delete(`/api/citation/items/${id}`)
    setItems((prev) => prev.filter((i) => i.id !== id))
    loadPreview()
    loadGroupOptions()
  }

  async function updatePage(id: string, page_no: string) {
    await api.patch(`/api/citation/items/${id}`, { page_no })
    loadPreview()
  }

  async function updateGroup(id: string, group_name: string) {
    await api.patch(`/api/citation/items/${id}`, { group_name })
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, group_name } : i)))
    loadGroupOptions()
  }

  async function renameGroup(oldName: string, newName: string) {
    if (!newName.trim() || newName === oldName) return
    await api.post(`/api/citation/projects/${activeProjectId}/groups/rename`, {
      old_name: oldName,
      new_name: newName.trim(),
    })
    setItems((prev) => prev.map((i) => (i.group_name === oldName ? { ...i, group_name: newName.trim() } : i)))
    loadGroupOptions()
    toast.success('分组已重命名')
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const activeProject = projects.find((p) => p.id === activeProjectId)

  if (loading) {
    return (
      <div className="empty-state" style={{ minHeight: '60vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <>
      <div className="topbar citation-topbar">
        <div className="citation-topbar-heading page-heading">
          <h1 className="page-title">引用篮</h1>
          <p className="page-subtitle">创建多个引用篮分组 · 读书时任选其一 · 预览中可逐条复制脚注与书目</p>
        </div>
        <div className="citation-topbar-actions">
          <PageSeg aria-label="引用篮操作">
            {activeProject && (
              <PageSegItem
                tone="danger"
                icon={<Trash2 size={15} />}
                label="删除当前"
                shortLabel="删除"
                title="删除当前引用篮"
                onClick={() => askDeleteProject(activeProject.id)}
              />
            )}
            <PageSegItem
              primary
              icon={<Plus size={15} />}
              label="新建引用篮"
              shortLabel="新建"
              onClick={() => setShowNewProject(true)}
            />
          </PageSeg>
        </div>
      </div>

      <div className="page-content citation-page">
        <PageSeg className="citation-project-bar" role="tablist" aria-label="引用篮" wrap>
          {projects.map((p) => (
            <PageSegItem
              key={p.id}
              role="tab"
              aria-selected={p.id === activeProjectId}
              active={p.id === activeProjectId}
              label={p.name}
              onClick={() => setActiveProjectId(p.id)}
            >
              <span className="citation-project-count" aria-label={`${p.item_count ?? 0} 条引用`}>
                {p.item_count ?? 0}
              </span>
            </PageSegItem>
          ))}
          {projects.length === 0 && <span className="citation-project-empty">暂无引用篮</span>}
        </PageSeg>

        {!activeProject ? (
          <div className="citation-empty-panel">
            <div className="citation-empty-title">创建一个引用篮</div>
            <div className="citation-empty-desc">相当于分组：读书划词时可选择加入哪个引用篮，默认使用「默认引用篮」</div>
            <button className="btn btn-primary" onClick={() => setShowNewProject(true)}>
              <Plus size={16} />
              新建引用篮
            </button>
          </div>
        ) : (
          <div className="citation-workspace">
            <section className="citation-panel">
              <header className="citation-panel-header">
                <div>
                  <h2 className="citation-panel-title">引文</h2>
                  <p className="citation-panel-desc">{items.length} 条 · 按分组导出</p>
                </div>
              </header>

              <div className="citation-panel-body">
                {items.length === 0 && (
                  <div className="citation-empty-inline">
                    在阅读器选中文字，点「引用」即可加入此处
                  </div>
                )}

                {groups.map(([groupKey, groupItems]) => {
                  const isUngrouped = groupKey === UNGROUPED
                  const isCollapsed = collapsed[groupKey]
                  return (
                    <div key={groupKey} className="citation-group">
                      <div className="citation-group-header" onClick={() => toggleCollapse(groupKey)}>
                        {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                        {isUngrouped ? (
                          <span className="citation-group-title muted">未分组</span>
                        ) : (
                          <input
                            className="citation-group-title-input"
                            defaultValue={groupKey}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => renameGroup(groupKey, e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                        )}
                        <span className="citation-group-count">{groupItems.length}</span>
                      </div>

                      {!isCollapsed &&
                        groupItems.map((item, index) => {
                          const globalIndex = items.findIndex((i) => i.id === item.id)
                          return (
                            <div key={item.id} id={`citation-item-${item.id}`} className="citation-item">
                              <div className="citation-order">{globalIndex + 1}</div>
                              <div className="citation-item-cover" aria-hidden>
                                {item.book_cover_url ? (
                                  <img src={item.book_cover_url} alt="" loading="lazy" />
                                ) : (
                                  <span className="citation-item-cover-fallback">
                                    {(item.book_title || '书').slice(0, 1)}
                                  </span>
                                )}
                              </div>
                              <div className="citation-item-main">
                                <div className="citation-item-book">
                                  <span className="citation-item-title">{item.book_title || '未知书名'}</span>
                                  {(item.book_authors || []).length > 0 && (
                                    <span className="citation-item-authors">
                                      {(item.book_authors || []).filter(Boolean).join('、')}
                                    </span>
                                  )}
                                </div>
                                <div className="citation-item-quote">{item.quoted_text}</div>
                                <div className="citation-item-meta">
                                  <label className="citation-field" title="脚注中的纸书页码，请与所引版本核对">
                                    <span>纸书页</span>
                                    <input
                                      className="input citation-field-input"
                                      defaultValue={item.page_no}
                                      placeholder="必填"
                                      onBlur={(e) => updatePage(item.id, e.target.value)}
                                    />
                                  </label>
                                  <label className="citation-field">
                                    <span>分组</span>
                                    <input
                                      className="input citation-field-input wide"
                                      list="citation-group-suggestions"
                                      placeholder="未分组"
                                      defaultValue={item.group_name}
                                      onBlur={(e) => {
                                        if (e.target.value !== item.group_name) {
                                          updateGroup(item.id, e.target.value.trim())
                                        }
                                      }}
                                    />
                                  </label>
                                </div>
                              </div>
                              <div className="citation-item-actions">
                                <button
                                  className="icon-btn"
                                  type="button"
                                  title="上移"
                                  onClick={() => moveWithinGroup(groupKey, index, -1)}
                                >
                                  <ArrowUp size={13} />
                                </button>
                                <button
                                  className="icon-btn"
                                  type="button"
                                  title="下移"
                                  onClick={() => moveWithinGroup(groupKey, index, 1)}
                                >
                                  <ArrowDown size={13} />
                                </button>
                                <button
                                  className="icon-btn"
                                  type="button"
                                  title="删除"
                                  onClick={() => removeItem(item.id)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  )
                })}

                <datalist id="citation-group-suggestions">
                  {groupOptions.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>

                {items.length > 0 && (
                  <div className="citation-hint">
                    <FolderPlus size={13} />
                    <span>在「分组」填写主题即可归类；预览顺序按分组先后排列</span>
                  </div>
                )}
              </div>
            </section>

            <section className="citation-panel citation-panel-export">
              <header className="citation-panel-header">
                <div>
                  <h2 className="citation-panel-title">预览</h2>
                  <p className="citation-panel-desc">脚注与参考书目，逐条复制</p>
                </div>
                <div className="citation-variant" role="group" aria-label="简繁体">
                  <button
                    type="button"
                    className={variant === 'simplified' ? 'active' : ''}
                    onClick={() => setVariant('simplified')}
                  >
                    简体
                  </button>
                  <button
                    type="button"
                    className={variant === 'traditional' ? 'active' : ''}
                    onClick={() => setVariant('traditional')}
                  >
                    繁体
                  </button>
                </div>
              </header>

              <div className="citation-preview-block">
                <div className="citation-preview-label-row">
                  <div className="citation-preview-label">脚注预览</div>
                  <button
                    type="button"
                    className="btn btn-sm citation-copy-all"
                    disabled={footnotes.length === 0}
                    title="复制全部脚注"
                    onClick={() =>
                      copyText(
                        '全部脚注',
                        footnotes.map((f) => `${f.order}. ${f.text}`).join('\n'),
                      )
                    }
                  >
                    <Copy size={13} />
                    全部
                  </button>
                </div>
                <div className="citation-preview-scroll">
                  {footnotes.map((f) => (
                    <div key={f.order} className="footnote-preview citation-preview-row">
                      <div className="citation-preview-row-text">
                        {f.order}. {f.text}
                      </div>
                      <button
                        type="button"
                        className="icon-btn citation-preview-copy"
                        title={`复制脚注 ${f.order}`}
                        aria-label={`复制脚注 ${f.order}`}
                        onClick={() => copyText(`脚注 ${f.order}`, `${f.order}. ${f.text}`)}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ))}
                  {footnotes.length === 0 && <div className="citation-preview-empty">暂无引用</div>}
                </div>
              </div>

              <div className="citation-preview-block">
                <div className="citation-preview-label-row">
                  <div className="citation-preview-label">参考书目 · 按姓氏笔画</div>
                  <button
                    type="button"
                    className="btn btn-sm citation-copy-all"
                    disabled={bibliography.length === 0}
                    title="复制全部参考书目"
                    onClick={() => copyText('全部参考书目', bibliography.map((b) => b.text).join('\n'))}
                  >
                    <Copy size={13} />
                    全部
                  </button>
                </div>
                <div className="citation-preview-scroll">
                  {bibliography.map((b, i) => (
                    <div key={i} className="footnote-preview citation-preview-row">
                      <div className="citation-preview-row-text">
                        {b.text}
                        {!b.stroke_estimated && (
                          <span className="badge badge-muted" style={{ marginLeft: 6 }}>
                            笔画待核对
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="icon-btn citation-preview-copy"
                        title="复制本条书目"
                        aria-label={`复制参考书目 ${i + 1}`}
                        onClick={() => copyText('参考书目', b.text)}
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ))}
                  {bibliography.length === 0 && <div className="citation-preview-empty">暂无书目</div>}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={async (id) => {
            setShowNewProject(false)
            await loadProjects()
            setActiveProjectId(id)
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除引用篮"
          lead={
            <>
              确认删除引用篮「<strong>{pendingDelete.name}</strong>」？
            </>
          }
          description="其中全部引用将一并删除，且不可恢复。"
          busy={deletingProject}
          busyLabel="删除中…"
          onClose={() => !deletingProject && setPendingDelete(null)}
          onConfirm={confirmDeleteProject}
        />
      )}
    </>
  )
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const resp = await api.post<{ id: string }>('/api/citation/projects', { name })
      toast.success('引用篮已创建')
      onCreated(resp.id)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="新建引用篮" onClose={onClose}>
      <div className="field">
        <label>引用篮名称</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：毕业论文第三章"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submit} disabled={busy}>
        创建
      </button>
    </Modal>
  )
}
