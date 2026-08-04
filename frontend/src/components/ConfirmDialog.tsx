import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import Modal from './Modal'

/** 站内确认弹窗：替代 window.confirm，与详情页删除书籍等风格一致 */
export default function ConfirmDialog({
  title,
  lead,
  description,
  confirmLabel = '确认删除',
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
      <div className="confirm-dialog">
        <div className="confirm-dialog-lead">{lead}</div>
        {description ? <p className="confirm-dialog-desc">{description}</p> : null}
        {children}
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
            {danger ? <Trash2 size={15} /> : null}
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
