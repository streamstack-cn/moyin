/** Toast 专用图标：笔画饱满、viewBox 紧，避免 Lucide 默认留白导致「勾太小」 */

type GlyphProps = { className?: string }

export function ToastCheckIcon({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.8 12.6 9.2 18 20.2 5.8"
        stroke="currentColor"
        strokeWidth="3.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ToastCloseIcon({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6 18 18M18 6 6 18"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ToastWarnIcon({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4.2 21.2 20.2H2.8L12 4.2Z"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v5.2" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="12" cy="18.2" r="1.35" fill="currentColor" />
    </svg>
  )
}

export function ToastInfoIcon({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="2.8" />
      <path d="M12 10.6v6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="12" cy="7.4" r="1.4" fill="currentColor" />
    </svg>
  )
}
