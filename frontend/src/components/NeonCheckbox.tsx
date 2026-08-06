/**
 * NeonCheckbox — 全项目统一勾选框（与 streamstack 一致）
 *
 * 用法：
 *   <NeonCheckbox checked={val} onChange={setVal} label="启用…" />
 */
import { useId } from 'react'
import './NeonCheckbox.css'

interface NeonCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  id?: string
}

export default function NeonCheckbox({ checked, onChange, label, disabled, id }: NeonCheckboxProps) {
  const genId = useId()
  const checkboxId = id || genId

  return (
    <div
      className={`ui-checkbox-wrapper${disabled ? ' disabled' : ''}`}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
    >
      <input
        type="checkbox"
        className="ui-checkbox"
        id={checkboxId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
      {label ? (
        <label className="ui-checkbox-label" htmlFor={checkboxId}>
          {label}
        </label>
      ) : null}
    </div>
  )
}
