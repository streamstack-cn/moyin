import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { modalBackdropVariants, modalCardVariants } from '../lib/motion'

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
  const reduceMotion = useReducedMotion()
  const [show, setShow] = useState(true)

  function requestClose() {
    if (reduceMotion) {
      onClose()
      return
    }
    setShow(false)
  }

  const node = (
    <AnimatePresence onExitComplete={onClose}>
      {show && (
        <motion.div
          className="modal-backdrop"
          onClick={closeOnBackdrop ? requestClose : undefined}
          variants={reduceMotion ? undefined : modalBackdropVariants}
          initial={reduceMotion ? false : 'initial'}
          animate="animate"
          exit={reduceMotion ? undefined : 'exit'}
        >
          <motion.div
            className="card modal-card"
            style={width ? { maxWidth: width } : undefined}
            onClick={(e) => e.stopPropagation()}
            variants={reduceMotion ? undefined : modalCardVariants}
            initial={reduceMotion ? false : 'initial'}
            animate="animate"
            exit={reduceMotion ? undefined : 'exit'}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="modal-title" style={{ marginBottom: 0 }}>
                {title}
              </div>
              <button className="icon-btn" onClick={requestClose} aria-label="关闭">
                <X size={18} />
              </button>
            </div>
            <div style={{ marginTop: 18 }}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  if (typeof document === 'undefined') return node
  return createPortal(node, document.body)
}
