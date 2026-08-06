import type { ButtonHTMLAttributes, ReactNode } from 'react'

type SegTone = 'default' | 'primary' | 'danger'

/** 站内统一分段控件外壳：与管理后台 tab 框体同一视觉语言 */
export function PageSeg({
  children,
  className = '',
  role = 'toolbar',
  'aria-label': ariaLabel,
  wrap = false,
}: {
  children: ReactNode
  className?: string
  role?: 'toolbar' | 'tablist' | 'group'
  'aria-label'?: string
  /** 多项换行（如引用篮列表）时用圆角矩形外壳 */
  wrap?: boolean
}) {
  return (
    <div
      className={`page-seg${wrap ? ' page-seg-wrap' : ''}${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
}

type PageSegItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon?: ReactNode
  label: ReactNode
  /** 窄屏短文案；不传则始终显示 label */
  shortLabel?: ReactNode
  /** 选中态（tab / 视图切换） */
  active?: boolean
  /** 强调主操作（上传、新建、生成等） */
  primary?: boolean
  tone?: SegTone
  children?: ReactNode
}

/** 分段控件内的一项：可选中、可作主操作 / 危险操作 */
export function PageSegItem({
  icon,
  label,
  shortLabel,
  active = false,
  primary = false,
  tone = 'default',
  className = '',
  children,
  type = 'button',
  ...rest
}: PageSegItemProps) {
  const classes = [
    'page-seg-item',
    active ? 'is-active' : '',
    primary ? 'is-primary' : '',
    tone === 'danger' ? 'is-danger' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {shortLabel != null ? (
        <>
          <span className="btn-label-full">{label}</span>
          <span className="btn-label-short">{shortLabel}</span>
        </>
      ) : (
        <span className="page-seg-label">{label}</span>
      )}
      {children}
    </button>
  )
}
