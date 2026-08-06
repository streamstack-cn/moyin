export const READER_THEMES = [
  { id: 'paper', label: '米白', bg: '#f4ecd8', fg: '#2b2620' },
  { id: 'white', label: '纯白', bg: '#ffffff', fg: '#1c1c1c' },
  { id: 'sepia', label: '护眼', bg: '#eee3ca', fg: '#3a3226' },
  { id: 'mint', label: '薄荷', bg: '#dcece6', fg: '#1f322b' },
  { id: 'dark', label: '深灰', bg: '#2a2a2a', fg: '#d8d3c8' },
  { id: 'black', label: '纯黑', bg: '#000000', fg: '#b8b8b8' },
] as const

export function resolveReaderTheme(themeId: string, customBg: string): { bg: string; fg: string } {
  if (themeId === 'custom') {
    // 自定义背景色时，按亮度自动选择黑/白文字，保证可读性
    const hex = customBg.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16) || 0
    const g = parseInt(hex.substring(2, 4), 16) || 0
    const b = parseInt(hex.substring(4, 6), 16) || 0
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return { bg: customBg, fg: luminance > 0.5 ? '#2b2620' : '#e8e3d8' }
  }
  const preset = READER_THEMES.find((t) => t.id === themeId)
  return preset ? { bg: preset.bg, fg: preset.fg } : { bg: '#f4ecd8', fg: '#2b2620' }
}
