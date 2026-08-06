import { Loader2, Square, Trash2, Wand2 } from 'lucide-react'

export type BatchPhase = 'running' | 'stopping' | 'done' | 'stopped'
export type BatchKind = 'rematch' | 'delete'

export interface BatchProgressJob {
  kind: BatchKind
  phase: BatchPhase
  total: number
  success: number
  failed: number
  currentTitle: string
  /** 尚未处理完的 id（含当前正在处理的） */
  remainingIds: string[]
  /** 失败的 id，结束后保留勾选 */
  failedIds: string[]
}

export function BatchProgressPanel({
  job,
  onStop,
  onClose,
}: {
  job: BatchProgressJob
  onStop: () => void
  onClose: () => void
}) {
  const isDelete = job.kind === 'delete'
  const done = job.success + job.failed
  const inFlight = job.phase === 'running' || job.phase === 'stopping' ? job.remainingIds.length : 0
  const pct = job.total > 0 ? Math.min(100, Math.round((done / job.total) * 100)) : 0
  const running = job.phase === 'running' || job.phase === 'stopping'

  const title =
    job.phase === 'stopping'
      ? '正在停止…'
      : job.phase === 'stopped'
        ? isDelete
          ? '已停止删除'
          : '已停止匹配'
        : job.phase === 'done'
          ? isDelete
            ? '删除完成'
            : '匹配完成'
          : isDelete
            ? '正在删除…'
            : '正在重新匹配…'

  const sub =
    running && job.currentTitle
      ? `当前：《${job.currentTitle}》`
      : job.phase === 'stopped'
        ? `未处理 ${job.remainingIds.length} 本已保留勾选，可继续操作`
        : job.phase === 'done'
          ? job.failed > 0
            ? isDelete
              ? '删除失败的书仍保留勾选'
              : '未匹配成功的书仍保留勾选'
            : '所选书籍已全部处理完毕'
          : `共 ${job.total} 本，请稍候`

  const pendingLabel = running ? (isDelete ? '删除中' : '匹配中') : '未处理'
  const stopLabel = job.phase === 'stopping' ? '停止中…' : isDelete ? '停止删除' : '停止匹配'

  return (
    <div className="rematch-progress" role="status" aria-live="polite">
      <div className="upload-progress">
        <div className="upload-progress-icon">
          {running ? (
            <Loader2 size={22} className="spin" />
          ) : isDelete ? (
            <Trash2 size={22} />
          ) : (
            <Wand2 size={22} />
          )}
        </div>
        <div className="upload-progress-text">
          <div className="upload-progress-title">{title}</div>
          <div className="upload-progress-sub">{sub}</div>
        </div>
        <div className="upload-progress-bar rematch-progress-bar" aria-hidden="true">
          <span className="rematch-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="rematch-stats" aria-label={isDelete ? '删除进度' : '匹配进度'}>
        <div className="rematch-stat">
          <div className="rematch-stat-value is-ok">{job.success}</div>
          <div className="rematch-stat-label">{isDelete ? '已删除' : '已成功'}</div>
        </div>
        <div className="rematch-stat">
          <div className="rematch-stat-value is-fail">{job.failed}</div>
          <div className="rematch-stat-label">已失败</div>
        </div>
        <div className="rematch-stat">
          <div className="rematch-stat-value is-pending">{inFlight}</div>
          <div className="rematch-stat-label">{pendingLabel}</div>
        </div>
      </div>

      <div className="rematch-progress-meta">
        进度 {done}/{job.total}
        {job.total > 0 ? ` · ${pct}%` : ''}
      </div>

      <div className="confirm-dialog-actions" style={{ marginTop: 18 }}>
        {running ? (
          <button
            type="button"
            className="btn"
            disabled={job.phase === 'stopping'}
            onClick={onStop}
          >
            <Square size={14} />
            {stopLabel}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            完成
          </button>
        )}
      </div>
    </div>
  )
}
