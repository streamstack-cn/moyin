import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export default function Modal({
  title,
  onClose,
  children,
  width,
  closeOnBackdrop = true,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
  /** 点击遮罩是否关闭，默认 true；元数据匹配等长操作场景可关闭 */
  closeOnBackdrop?: boolean
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className="card modal-card"
        style={width ? { maxWidth: width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="modal-title" style={{ marginBottom: 0 }}>
            {title}
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div style={{ marginTop: 18 }}>{children}</div>
      </div>
    </div>
  )
}
