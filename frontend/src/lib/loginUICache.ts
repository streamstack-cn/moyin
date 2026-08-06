import type { ColorSchemeId, FontFamilyId } from '../contexts/UISettingsContext'

const CACHE_KEY = 'moyin_login_ui_cache'
const SCHEME_KEY = 'moyin_ui_color_scheme'
const UI_FONT_KEY = 'moyin_ui_font'
const READER_FONT_KEY = 'moyin_reader_font'
const ANIM_KEY = 'moyin_ui_advanced_anim'
const COVER_KEY = 'moyin_ui_login_cover_flow'
const FINISH_NUDGE_KEY = 'moyin_ui_finish_nudge'
const THEME_KEY = 'moyin_theme'

/** 写入后通知登录页等监听方立刻刷新（同页 SPA） */
export const LOGIN_UI_CACHE_EVENT = 'moyin-login-ui-cache'

const SCHEMES: ColorSchemeId[] = [
  'default',
  'inkwash',
  'ocean',
  'forest',
  'sunset',
  'sakura',
  'arctic',
  'amber',
  'morandi',
]
const FONTS: FontFamilyId[] = ['default', 'smiley', 'dingtalk', 'wqy']

export interface LoginUICache {
  colorScheme: ColorSchemeId
  uiFont: FontFamilyId
  readerFont: FontFamilyId
  advancedAnim: boolean
  loginCoverFlow: boolean
  /** 继续阅读久未翻开提示（默认开） */
  finishNudge: boolean
  theme?: 'dark' | 'light'
}

function asScheme(v: unknown, fallback: ColorSchemeId = 'inkwash'): ColorSchemeId {
  return typeof v === 'string' && SCHEMES.includes(v as ColorSchemeId)
    ? (v as ColorSchemeId)
    : fallback
}

function asFont(v: unknown, fallback: FontFamilyId = 'default'): FontFamilyId {
  return typeof v === 'string' && FONTS.includes(v as FontFamilyId)
    ? (v as FontFamilyId)
    : fallback
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function readTheme(): 'dark' | 'light' | undefined {
  const t = localStorage.getItem(THEME_KEY)
  return t === 'light' || t === 'dark' ? t : undefined
}

/** 从账号 preferences 合并写入本机；缺字段时保留已有缓存，绝不回退成「默认开/默认橙」 */
export function writeLoginUICacheFromPreferences(prefs: Record<string, unknown> | null | undefined) {
  const p = prefs || {}
  const prev = readLoginUICache()
  const cache: LoginUICache = {
    colorScheme:
      typeof p.ui_color_scheme === 'string' && p.ui_color_scheme
        ? asScheme(p.ui_color_scheme, prev.colorScheme)
        : prev.colorScheme,
    uiFont:
      typeof p.ui_font === 'string' && p.ui_font ? asFont(p.ui_font, prev.uiFont) : prev.uiFont,
    readerFont:
      typeof p.reader_font_family === 'string' && p.reader_font_family
        ? asFont(p.reader_font_family, prev.readerFont)
        : prev.readerFont,
    advancedAnim: asBool(p.ui_advanced_anim, prev.advancedAnim),
    loginCoverFlow: asBool(p.ui_login_cover_flow, prev.loginCoverFlow),
    finishNudge: asBool(p.ui_finish_nudge, prev.finishNudge),
    theme:
      p.theme === 'light' || p.theme === 'dark' ? p.theme : prev.theme ?? readTheme(),
  }
  writeLoginUICache(cache)
  return cache
}

export function writeLoginUICache(cache: LoginUICache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
  localStorage.setItem(SCHEME_KEY, cache.colorScheme)
  localStorage.setItem(UI_FONT_KEY, cache.uiFont)
  localStorage.setItem(READER_FONT_KEY, cache.readerFont)
  localStorage.setItem(ANIM_KEY, String(cache.advancedAnim))
  localStorage.setItem(COVER_KEY, String(cache.loginCoverFlow))
  localStorage.setItem(FINISH_NUDGE_KEY, String(cache.finishNudge))
  if (cache.theme === 'light' || cache.theme === 'dark') {
    localStorage.setItem(THEME_KEY, cache.theme)
  }

  const root = document.documentElement
  if (cache.colorScheme && cache.colorScheme !== 'default') {
    root.setAttribute('data-color-scheme', cache.colorScheme)
  } else {
    root.removeAttribute('data-color-scheme')
  }
  if (cache.uiFont && cache.uiFont !== 'default') {
    root.setAttribute('data-ui-font', cache.uiFont)
  } else {
    root.removeAttribute('data-ui-font')
  }
  if (cache.theme) {
    root.setAttribute('data-theme', cache.theme)
  }

  try {
    window.dispatchEvent(new CustomEvent(LOGIN_UI_CACHE_EVENT, { detail: cache }))
  } catch {
    /* ignore */
  }
}

/** 登录页读取：优先专用缓存，再回退旧 key */
export function readLoginUICache(): LoginUICache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LoginUICache>
      return {
        colorScheme: asScheme(parsed.colorScheme),
        uiFont: asFont(parsed.uiFont),
        readerFont: asFont(parsed.readerFont),
        // 显式 false 必须保留；缺省才默认开
        advancedAnim: parsed.advancedAnim !== false,
        loginCoverFlow: parsed.loginCoverFlow !== false,
        finishNudge: parsed.finishNudge !== false,
        theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : readTheme(),
      }
    }
  } catch {
    /* ignore */
  }
  return {
    colorScheme: asScheme(localStorage.getItem(SCHEME_KEY)),
    uiFont: asFont(localStorage.getItem(UI_FONT_KEY)),
    readerFont: asFont(localStorage.getItem(READER_FONT_KEY)),
    advancedAnim: localStorage.getItem(ANIM_KEY) !== 'false',
    loginCoverFlow: localStorage.getItem(COVER_KEY) !== 'false',
    finishNudge: localStorage.getItem(FINISH_NUDGE_KEY) !== 'false',
    theme: readTheme(),
  }
}
