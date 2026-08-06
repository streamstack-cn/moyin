import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Edit3, FolderPlus, GripVertical, Loader2, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import type { Library } from '../../api/types'
import ConfirmDialog from '../ConfirmDialog'
import Modal from '../Modal'
import NeonCheckbox from '../NeonCheckbox'
import { DirectoryBrowser } from './DirectoryBrowser'

export function LibraryModal({
  libraries,
  onClose,
  onChanged,
}: {
  libraries: Library[]
  onClose: () => void
  onChanged: (opts?: { silent?: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [watchOnCreate, setWatchOnCreate] = useState(false)
  const [disablingAuto, setDisablingAuto] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Library | null>(null)
  const [deletingLibrary, setDeletingLibrary] = useState(false)
  const watchingCount = libraries.filter((l) => l.scan_mode === 'watch').length

  // 书架排序：拖拽把手改变书架显示顺序（影响「按书架」分组视图与筛选栏顺序）
  const [orderedLibs, setOrderedLibs] = useState<Library[]>(libraries)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  useEffect(() => {
    setOrderedLibs(libraries)
  }, [libraries])

  async function commitOrder(next: Library[]) {
    setOrderedLibs(next)
    setSavingOrder(true)
    try {
      await api.put('/api/libraries/reorder', { library_ids: next.map((l) => l.id) })
      onChanged({ silent: true })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '排序保存失败')
      setOrderedLibs(libraries)
    } finally {
      setSavingOrder(false)
    }
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const next = [...orderedLibs]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(targetIndex, 0, moved)
    setDragIndex(null)
    setDragOverIndex(null)
    void commitOrder(next)
  }

  async function createLibrary() {
    if (!name || !rootPath) return
    setBusy(true)
    try {
      await api.post('/api/libraries', {
        name,
        root_path: rootPath,
        scan_mode: watchOnCreate ? 'watch' : 'manual',
      })
      toast.success(watchOnCreate ? '书架已添加（已开启变动监控）' : '书架已添加（仅手动扫描）')
      setName('')
      setRootPath('')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  async function toggleWatch(lib: Library) {
    const next = lib.scan_mode === 'watch' ? 'manual' : 'watch'
    try {
      await api.patch(`/api/libraries/${lib.id}`, { scan_mode: next })
      toast.success(next === 'watch' ? '已开启目录变动自动刷新' : '已改为仅手动扫描')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '更新失败')
    }
  }

  async function disableAllAutoScan() {
    if (disablingAuto) return
    setDisablingAuto(true)
    try {
      const res = await api.post<{
        disabled_watch_count: number
        cleared_queue: number
      }>('/api/libraries/watch/disable-all')
      toast.success(
        `已关闭全部自动扫描：${res.disabled_watch_count} 个监控已关，定时扫描已关，排队已清空`,
      )
      onChanged({ silent: true })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '关闭失败')
    } finally {
      setDisablingAuto(false)
    }
  }

  async function scanLibrary(id: string) {
    try {
      await api.post(`/api/libraries/${id}/scan`)
      toast.success('已排队后台扫描；大库请用顶栏「停止扫描」随时中止')
      let tries = 0
      const timer = window.setInterval(async () => {
        tries += 1
        try {
          const status = await api.get<{ busy: boolean }>('/api/libraries/scan/status')
          if (!status.busy || tries >= 180) {
            window.clearInterval(timer)
            onChanged({ silent: true })
            if (!status.busy && tries > 1) toast.success('目录扫描已结束')
          }
        } catch {
          if (tries >= 180) window.clearInterval(timer)
        }
      }, 2000)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '扫描失败')
    }
  }

  async function saveRename(id: string) {
    if (!renameValue.trim()) {
      setRenamingId(null)
      return
    }
    try {
      await api.patch(`/api/libraries/${id}`, { name: renameValue.trim() })
      toast.success('映射名已更新')
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重命名失败')
    } finally {
      setRenamingId(null)
    }
  }

  async function confirmDeleteLibrary() {
    if (!pendingDelete || deletingLibrary) return
    setDeletingLibrary(true)
    try {
      await api.delete(`/api/libraries/${pendingDelete.id}`)
      toast.success('书架已删除')
      setPendingDelete(null)
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setDeletingLibrary(false)
    }
  }

  return (
    <>
    <Modal title="书库目录管理" onClose={onClose} width={620}>
      <div style={{ color: 'var(--ink-faint)', fontSize: 12.5, marginBottom: 12 }}>
        把宿主机上的电子书目录挂载进容器后，在此逐级浏览、选中某个文件夹即可创建一个「书架」；
        书架显示名（映射名）与实际文件夹名相互独立，随时可改。大库（如摄影）请保持「监控关」，只在需要时手动扫描。
      </div>

      {(watchingCount > 0 || libraries.length > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={disablingAuto}
            onClick={disableAllAutoScan}
            title="关闭所有书架监控 + 全局定时扫描，并停止正在进行的扫描"
          >
            {disablingAuto ? '关闭中…' : `关闭全部自动扫描${watchingCount ? `（${watchingCount}）` : ''}`}
          </button>
        </div>
      )}

      {orderedLibs.length > 1 && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          <GripVertical size={12} /> 拖拽左侧手柄可调整书架顺序（影响「按书架」分组与筛选栏排列）
          {savingOrder && <Loader2 size={12} className="spin" />}
        </div>
      )}
      {orderedLibs.map((lib, index) => (
        <div
          key={lib.id}
          className={`citation-item shelf-order-row${dragOverIndex === index && dragIndex !== null && dragIndex !== index ? ' drag-over' : ''}${dragIndex === index ? ' dragging' : ''}`}
          style={{ alignItems: 'center' }}
          onDragOver={(e) => {
            e.preventDefault()
            if (dragOverIndex !== index) setDragOverIndex(index)
          }}
          onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
          onDrop={(e) => {
            e.preventDefault()
            handleDrop(index)
          }}
        >
          <span
            className="shelf-order-handle"
            draggable
            title="拖拽调整顺序"
            aria-label="拖拽调整书架顺序"
            onDragStart={(e) => {
              setDragIndex(index)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              setDragIndex(null)
              setDragOverIndex(null)
            }}
          >
            <GripVertical size={15} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {renamingId === lib.id ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  style={{ padding: '4px 8px', fontSize: 13 }}
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename(lib.id)}
                />
                <button className="btn btn-sm btn-primary" onClick={() => saveRename(lib.id)}>
                  保存
                </button>
              </div>
            ) : (
              <div
                style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                onClick={() => {
                  setRenamingId(lib.id)
                  setRenameValue(lib.name)
                }}
                title="点击重命名映射名"
              >
                {lib.name}
                <Edit3 size={11} style={{ opacity: 0.5 }} />
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lib.root_path}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 3 }}>
              {lib.book_count} 本 · {lib.scan_mode === 'watch' ? '监控中' : '手动'} ·{' '}
              {lib.last_scanned_at ? `上次扫描 ${new Date(lib.last_scanned_at).toLocaleString()}` : '尚未扫描'}
            </div>
          </div>
          <button
            className={`btn btn-sm ${lib.scan_mode === 'watch' ? 'btn-primary' : ''}`}
            onClick={() => toggleWatch(lib)}
            title={lib.scan_mode === 'watch' ? '关闭自动监控' : '开启目录变动自动刷新'}
          >
            {lib.scan_mode === 'watch' ? '监控开' : '监控关'}
          </button>
          <button className="btn btn-sm" onClick={() => scanLibrary(lib.id)}>
            扫描
          </button>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setPendingDelete(lib)} title="删除书架">
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      <div className="divider" />

      <div className="field">
        <label>映射名（显示在书库筛选中的书架名称）</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：神学资料" />
      </div>
      <div className="field">
        <label>源目录（容器内绝对路径）</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="点击右侧「浏览挂载目录」选择，或手动填写"
          />
          <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => setShowBrowser((v) => !v)}>
            <FolderPlus size={14} />
            浏览挂载目录
          </button>
        </div>
      </div>

      {showBrowser && (
        <DirectoryBrowser
          onPick={(path, folderName) => {
            setRootPath(path)
            if (!name) setName(folderName)
            setShowBrowser(false)
          }}
        />
      )}

      <div style={{ marginTop: 12 }}>
        <NeonCheckbox
          checked={watchOnCreate}
          onChange={setWatchOnCreate}
          label="开启目录变动自动刷新（默认关闭；大库勿开，避免自动扫入新书）"
        />
      </div>

      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={createLibrary} disabled={busy}>
        {busy ? '添加中…' : '添加书架'}
      </button>
    </Modal>

    {pendingDelete && (
      <ConfirmDialog
        title="删除书架"
        lead={
          <>
            确认删除书架「<strong>{pendingDelete.name}</strong>」？
          </>
        }
        description="不会删除已入库的书籍，仅解除目录关联。"
        busy={deletingLibrary}
        busyLabel="删除中…"
        onClose={() => !deletingLibrary && setPendingDelete(null)}
        onConfirm={confirmDeleteLibrary}
      />
    )}
    </>
  )
}
