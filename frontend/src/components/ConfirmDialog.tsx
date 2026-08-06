import type { ReactNode } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import Modal from './Modal'

/** 站内确认弹窗：替代 window.confirm，与详情页删除书籍等风格一致 */
export default function ConfirmDialog({
  title,
  lead,
  description,
  confirmLabel = '确认删除',
  busyLabel = '处理中…',
  cancelLabel = '取消',
  danger = true,
  busy = false,
  width = 420,
  onClose,
  onConfirm,
  children,
}: {
  title: string
  lead: ReactNode
  description?: ReactNode
  confirmLabel?: string
  busyLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  width?: number
  onClose: () => void
  onConfirm: () => void | Promise<void>
  children?: ReactNode
}) {
  return (
    <Modal title={title} onClose={() => !busy && onClose()} width={width} closeOnBackdrop={!busy}>
      <div className={`confirm-dialog${busy ? ' is-busy' : ''}`}>
        <div className="confirm-dialog-lead">{lead}</div>
        {description ? <p className="confirm-dialog-desc">{description}</p> : null}
        {children}
        {busy ? (
          <div className="confirm-dialog-busy" aria-live="polite">
            <Loader2 size={16} className="spin" aria-hidden />
            <span>{busyLabel}</span>
          </div>
        ) : null}
        <div className="confirm-dialog-actions">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`btn${danger ? ' btn-danger' : ' btn-primary'}`}
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? <Loader2 size={15} className="spin" aria-hidden /> : danger ? <Trash2 size={15} /> : null}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
