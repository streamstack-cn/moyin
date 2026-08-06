import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { readLoginUICache, writeLoginUICache, type LoginUICache } from '../lib/loginUICache'

export type ColorSchemeId =
  | 'default'
  | 'inkwash'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'sakura'
  | 'arctic'
  | 'amber'
  | 'morandi'

export type FontFamilyId = 'default' | 'smiley' | 'dingtalk' | 'wqy'

export interface UISettingsState {
  colorScheme: ColorSchemeId
  uiFont: FontFamilyId
  readerFont: FontFamilyId
  advancedAnim: boolean
  /** 登录页封面流动背景（账号隔离；登录前读 localStorage） */
  loginCoverFlow: boolean
  /** 继续阅读久未翻开「请读完我」提示 */
  finishNudge: boolean
}

interface UISettingsContextValue extends UISettingsState {
  setColorScheme: (id: ColorSchemeId) => void
  setUiFont: (id: FontFamilyId) => void
  setReaderFont: (id: FontFamilyId) => void
  setAdvancedAnim: (on: boolean) => void
  setLoginCoverFlow: (on: boolean) => void
  setFinishNudge: (on: boolean) => void
}

const STORAGE = {
  colorScheme: 'moyin_ui_color_scheme',
  uiFont: 'moyin_ui_font',
  readerFont: 'moyin_reader_font',
  advancedAnim: 'moyin_ui_advanced_anim',
  loginCoverFlow: 'moyin_ui_login_cover_flow',
  finishNudge: 'moyin_ui_finish_nudge',
} as const

const UISettingsContext = createContext<UISettingsContextValue | null>(null)

function readBool(key: string, def: boolean): boolean {
  const v = localStorage.getItem(key)
  if (v === null) return def
  return v !== 'false'
}

function readScheme(): ColorSchemeId {
  const v = localStorage.getItem(STORAGE.colorScheme)
  const allowed: ColorSchemeId[] = [
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
  // 项目默认：水墨灰（无本机记录时）
  return allowed.includes(v as ColorSchemeId) ? (v as ColorSchemeId) : 'inkwash'
}

function readFont(key: string): FontFamilyId {
  const v = localStorage.getItem(key)
  const allowed: FontFamilyId[] = ['default', 'smiley', 'dingtalk', 'wqy']
  return allowed.includes(v as FontFamilyId) ? (v as FontFamilyId) : 'default'
}

function applyDom(settings: UISettingsState) {
  const root = document.documentElement
  if (settings.colorScheme && settings.colorScheme !== 'default') {
    root.setAttribute('data-color-scheme', settings.colorScheme)
  } else {
    root.removeAttribute('data-color-scheme')
  }

  if (settings.uiFont && settings.uiFont !== 'default') {
    root.setAttribute('data-ui-font', settings.uiFont)
  } else {
    root.removeAttribute('data-ui-font')
  }

  if (settings.readerFont && settings.readerFont !== 'default') {
    root.setAttribute('data-reader-font', settings.readerFont)
  } else {
    root.removeAttribute('data-reader-font')
  }

  if (settings.advancedAnim) {
    document.body.classList.remove('no-advanced-anim')
  } else {
    document.body.classList.add('no-advanced-anim')
  }
}

/** 登录页在未登录时也能读到账号同步后的偏好 */
export function readLoginCoverFlowPreference(): boolean {
  return readBool(STORAGE.loginCoverFlow, true)
}

/** 启动时同步把本机偏好写到 DOM，避免登录页首屏仍是默认配色/字体 */
export function bootstrapUISettingsFromStorage() {
  applyDom(readLoginUICache())
}

export function UISettingsProvider({ children }: { children: ReactNode }) {
  const { user, updatePreferences } = useAuth()
  const appliedUser = useRef<string | null>(null)

  const [colorScheme, setColorSchemeState] = useState<ColorSchemeId>(
    () => readLoginUICache().colorScheme,
  )
  const [uiFont, setUiFontState] = useState<FontFamilyId>(() => readLoginUICache().uiFont)
  const [readerFont, setReaderFontState] = useState<FontFamilyId>(() => readLoginUICache().readerFont)
  const [advancedAnim, setAdvancedAnimState] = useState(() => readLoginUICache().advancedAnim)
  const [loginCoverFlow, setLoginCoverFlowState] = useState(() => readLoginUICache().loginCoverFlow)
  const [finishNudge, setFinishNudgeState] = useState(() => readLoginUICache().finishNudge)

  const persist = useCallback(
    (patch: {
      colorScheme?: ColorSchemeId
      uiFont?: FontFamilyId
      readerFont?: FontFamilyId
      advancedAnim?: boolean
      loginCoverFlow?: boolean
      finishNudge?: boolean
    }) => {
      if (!user) return
      const body: Record<string, unknown> = {}
      if (patch.colorScheme !== undefined) body.ui_color_scheme = patch.colorScheme
      if (patch.uiFont !== undefined) body.ui_font = patch.uiFont
      if (patch.readerFont !== undefined) body.reader_font_family = patch.readerFont
      if (patch.advancedAnim !== undefined) body.ui_advanced_anim = patch.advancedAnim
      // 注意：false 必须原样提交，不能用 if (patch.xxx) 这种写法
      if (patch.loginCoverFlow !== undefined) body.ui_login_cover_flow = patch.loginCoverFlow
      if (patch.finishNudge !== undefined) body.ui_finish_nudge = patch.finishNudge
      void updatePreferences(body)
    },
    [user, updatePreferences],
  )

  useEffect(() => {
    // 登出后清空标记，确保再次登录会重新拉取账号偏好并写回本机
    if (!user) {
      appliedUser.current = null
      return
    }
    if (appliedUser.current === user.id) return
    appliedUser.current = user.id
    const p = user.preferences || {}
    const next: UISettingsState = {
      colorScheme:
        typeof p.ui_color_scheme === 'string' && p.ui_color_scheme
          ? (p.ui_color_scheme as ColorSchemeId)
          : readScheme(),
      uiFont:
        typeof p.ui_font === 'string' && p.ui_font ? (p.ui_font as FontFamilyId) : readFont(STORAGE.uiFont),
      readerFont:
        typeof p.reader_font_family === 'string' && p.reader_font_family
          ? (p.reader_font_family as FontFamilyId)
          : readFont(STORAGE.readerFont),
      advancedAnim:
        typeof p.ui_advanced_anim === 'boolean'
          ? p.ui_advanced_anim
          : readLoginUICache().advancedAnim,
      loginCoverFlow:
        typeof p.ui_login_cover_flow === 'boolean'
          ? p.ui_login_cover_flow
          : readLoginUICache().loginCoverFlow,
      finishNudge:
        typeof p.ui_finish_nudge === 'boolean'
          ? p.ui_finish_nudge
          : readLoginUICache().finishNudge,
    }
    setColorSchemeState(next.colorScheme)
    setUiFontState(next.uiFont)
    setReaderFontState(next.readerFont)
    setAdvancedAnimState(next.advancedAnim)
    setLoginCoverFlowState(next.loginCoverFlow)
    setFinishNudgeState(next.finishNudge)
    const prev = readLoginUICache()
    writeLoginUICache({
      ...next,
      theme:
        user.preferences?.theme === 'light' || user.preferences?.theme === 'dark'
          ? user.preferences.theme
          : prev.theme,
    })
    applyDom(next)
  }, [user])

  const commitLocal = useCallback((next: UISettingsState) => {
    const prev = readLoginUICache()
    const cache: LoginUICache = {
      ...next,
      theme: prev.theme,
    }
    writeLoginUICache(cache)
    applyDom(next)
  }, [])

  useEffect(() => {
    commitLocal({ colorScheme, uiFont, readerFont, advancedAnim, loginCoverFlow, finishNudge })
  }, [colorScheme, uiFont, readerFont, advancedAnim, loginCoverFlow, finishNudge, commitLocal])

  const snapshot = useCallback(
    (patch: Partial<UISettingsState>): UISettingsState => ({
      colorScheme,
      uiFont,
      readerFont,
      advancedAnim,
      loginCoverFlow,
      finishNudge,
      ...patch,
    }),
    [colorScheme, uiFont, readerFont, advancedAnim, loginCoverFlow, finishNudge],
  )

  const setColorScheme = useCallback(
    (id: ColorSchemeId) => {
      setColorSchemeState(id)
      commitLocal(snapshot({ colorScheme: id }))
      persist({ colorScheme: id })
    },
    [persist, commitLocal, snapshot],
  )
  const setUiFont = useCallback(
    (id: FontFamilyId) => {
      setUiFontState(id)
      commitLocal(snapshot({ uiFont: id }))
      persist({ uiFont: id })
    },
    [persist, commitLocal, snapshot],
  )
  const setReaderFont = useCallback(
    (id: FontFamilyId) => {
      setReaderFontState(id)
      commitLocal(snapshot({ readerFont: id }))
      persist({ readerFont: id })
    },
    [persist, commitLocal, snapshot],
  )
  const setAdvancedAnim = useCallback(
    (on: boolean) => {
      setAdvancedAnimState(on)
      commitLocal(snapshot({ advancedAnim: on }))
      persist({ advancedAnim: on })
    },
    [persist, commitLocal, snapshot],
  )
  const setLoginCoverFlow = useCallback(
    (on: boolean) => {
      setLoginCoverFlowState(on)
      commitLocal(snapshot({ loginCoverFlow: on }))
      persist({ loginCoverFlow: on })
    },
    [persist, commitLocal, snapshot],
  )
  const setFinishNudge = useCallback(
    (on: boolean) => {
      setFinishNudgeState(on)
      commitLocal(snapshot({ finishNudge: on }))
      persist({ finishNudge: on })
    },
    [persist, commitLocal, snapshot],
  )

  const value = useMemo<UISettingsContextValue>(
    () => ({
      colorScheme,
      uiFont,
      readerFont,
      advancedAnim,
      loginCoverFlow,
      finishNudge,
      setColorScheme,
      setUiFont,
      setReaderFont,
      setAdvancedAnim,
      setLoginCoverFlow,
      setFinishNudge,
    }),
    [
      colorScheme,
      uiFont,
      readerFont,
      advancedAnim,
      loginCoverFlow,
      finishNudge,
      setColorScheme,
      setUiFont,
      setReaderFont,
      setAdvancedAnim,
      setLoginCoverFlow,
      setFinishNudge,
    ],
  )

  return <UISettingsContext.Provider value={value}>{children}</UISettingsContext.Provider>
}

export function useUISettings() {
  const ctx = useContext(UISettingsContext)
  if (!ctx) throw new Error('useUISettings 必须在 UISettingsProvider 内使用')
  return ctx
}
