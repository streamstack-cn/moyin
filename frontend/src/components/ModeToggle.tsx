import { useId } from 'react'
import './ModeToggle.css'

interface ModeToggleProps {
  isDark: boolean
  onToggle: () => void
  className?: string
  title?: string
}

/** 深浅色高级动态开关（自 streamstack ModeToggle 适配） */
export default function ModeToggle({
  isDark,
  onToggle,
  className = '',
  title = '切换深色/浅色',
}: ModeToggleProps) {
  const id = useId()

  return (
    <label
      className={`mode-toggle ${className}`.trim()}
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        id={id}
        className="mode-toggle-input"
        checked={isDark}
        // 用 onChange 驱动主题切换；避免 onClick+preventDefault 把受控 checkbox 卡死
        onChange={() => onToggle()}
      />
      <div className="slider round" aria-hidden>
        <div className="sun-moon">
          <svg className="moon-dot moon-dot-1" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" />
          </svg>
          <svg className="moon-dot moon-dot-2" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" />
          </svg>
          <svg className="moon-dot moon-dot-3" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" />
          </svg>
          <svg className="light-ray light-ray-1" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" />
          </svg>
          <svg className="light-ray light-ray-2" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" />
          </svg>
          <svg className="light-ray light-ray-3" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" />
          </svg>
        </div>
        <div className="stars">
          <svg className="star star-1" viewBox="0 0 24 24">
            <path d="M12 8L13.5 11L17 11.5L14.5 14L15.1 17.5L12 15.8L8.9 17.5L9.5 14L7 11.5L10.5 11L12 8Z" />
          </svg>
          <svg className="star star-2" viewBox="0 0 24 24">
            <path d="M12 8L13.5 11L17 11.5L14.5 14L15.1 17.5L12 15.8L8.9 17.5L9.5 14L7 11.5L10.5 11L12 8Z" />
          </svg>
          <svg className="star star-3" viewBox="0 0 24 24">
            <path d="M12 8L13.5 11L17 11.5L14.5 14L15.1 17.5L12 15.8L8.9 17.5L9.5 14L7 11.5L10.5 11L12 8Z" />
          </svg>
          <svg className="star star-4" viewBox="0 0 24 24">
            <path d="M12 8L13.5 11L17 11.5L14.5 14L15.1 17.5L12 15.8L8.9 17.5L9.5 14L7 11.5L10.5 11L12 8Z" />
          </svg>
        </div>
        <div className="clouds">
          {/* 标准 24×24 云形，确保浅色蓝底上能看见白云 */}
          <svg className="cloud-light cloud-1" viewBox="0 0 24 24" aria-hidden>
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          <svg className="cloud-light cloud-2" viewBox="0 0 24 24" aria-hidden>
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          <svg className="cloud-light cloud-3" viewBox="0 0 24 24" aria-hidden>
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          <svg className="cloud-dark cloud-4" viewBox="0 0 24 24" aria-hidden>
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          <svg className="cloud-dark cloud-5" viewBox="0 0 24 24" aria-hidden>
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          <svg className="cloud-dark cloud-6" viewBox="0 0 24 24" aria-hidden>
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
        </div>
      </div>
    </label>
  )
}
