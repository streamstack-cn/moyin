import type { CSSProperties } from 'react'
import type { ColorSchemeId, FontFamilyId } from '../contexts/UISettingsContext'

type SchemeTokens = {
  accent: string
  accentStrong: string
  accentSoft: string
  accentSoftStrong: string
  accentInk: string
  gold: string
  goldStrong: string
  goldSoft: string
  goldSoftStrong: string
}

const DARK: Record<Exclude<ColorSchemeId, 'default'>, SchemeTokens> = {
  ocean: {
    accent: '#0ea5e9',
    accentStrong: '#38bdf8',
    accentSoft: 'rgba(14, 165, 233, 0.15)',
    accentSoftStrong: 'rgba(14, 165, 233, 0.3)',
    accentInk: '#041018',
    gold: '#14b8a6',
    goldStrong: '#2dd4bf',
    goldSoft: 'rgba(20, 184, 166, 0.14)',
    goldSoftStrong: 'rgba(20, 184, 166, 0.28)',
  },
  forest: {
    accent: '#10b981',
    accentStrong: '#34d399',
    accentSoft: 'rgba(16, 185, 129, 0.15)',
    accentSoftStrong: 'rgba(16, 185, 129, 0.3)',
    accentInk: '#04140c',
    gold: '#84cc16',
    goldStrong: '#a3e635',
    goldSoft: 'rgba(132, 204, 22, 0.14)',
    goldSoftStrong: 'rgba(132, 204, 22, 0.28)',
  },
  sunset: {
    accent: '#f97316',
    accentStrong: '#fb923c',
    accentSoft: 'rgba(249, 115, 22, 0.15)',
    accentSoftStrong: 'rgba(249, 115, 22, 0.3)',
    accentInk: '#1a0c04',
    gold: '#ec4899',
    goldStrong: '#f472b6',
    goldSoft: 'rgba(236, 72, 153, 0.14)',
    goldSoftStrong: 'rgba(236, 72, 153, 0.28)',
  },
  sakura: {
    accent: '#f43f5e',
    accentStrong: '#fb7185',
    accentSoft: 'rgba(244, 63, 94, 0.15)',
    accentSoftStrong: 'rgba(244, 63, 94, 0.3)',
    accentInk: '#1a0408',
    gold: '#a855f7',
    goldStrong: '#c084fc',
    goldSoft: 'rgba(168, 85, 247, 0.14)',
    goldSoftStrong: 'rgba(168, 85, 247, 0.28)',
  },
  arctic: {
    accent: '#38bdf8',
    accentStrong: '#7dd3fc',
    accentSoft: 'rgba(56, 189, 248, 0.15)',
    accentSoftStrong: 'rgba(56, 189, 248, 0.3)',
    accentInk: '#041018',
    gold: '#94a3b8',
    goldStrong: '#cbd5e1',
    goldSoft: 'rgba(148, 163, 184, 0.14)',
    goldSoftStrong: 'rgba(148, 163, 184, 0.28)',
  },
  amber: {
    accent: '#d97706',
    accentStrong: '#f59e0b',
    accentSoft: 'rgba(217, 119, 6, 0.15)',
    accentSoftStrong: 'rgba(217, 119, 6, 0.3)',
    accentInk: '#1a1004',
    gold: '#fb923c',
    goldStrong: '#fdba74',
    goldSoft: 'rgba(251, 146, 60, 0.14)',
    goldSoftStrong: 'rgba(251, 146, 60, 0.28)',
  },
  morandi: {
    accent: '#8e9ca2',
    accentStrong: '#a8b4b9',
    accentSoft: 'rgba(142, 156, 162, 0.18)',
    accentSoftStrong: 'rgba(142, 156, 162, 0.32)',
    accentInk: '#121416',
    gold: '#bda6a1',
    goldStrong: '#d4c4c0',
    goldSoft: 'rgba(189, 166, 161, 0.16)',
    goldSoftStrong: 'rgba(189, 166, 161, 0.3)',
  },
  /* 水墨灰：夜墨 + 淡墨/清墨；辅色青墨灰（功能色不用朱砂） */
  inkwash: {
    accent: '#a6a29a',
    accentStrong: '#c9c4bb',
    accentSoft: 'rgba(166, 162, 154, 0.16)',
    accentSoftStrong: 'rgba(166, 162, 154, 0.3)',
    accentInk: '#121110',
    gold: '#8a8f8a',
    goldStrong: '#a3a8a2',
    goldSoft: 'rgba(138, 143, 138, 0.14)',
    goldSoftStrong: 'rgba(138, 143, 138, 0.28)',
  },
}

const LIGHT: Record<Exclude<ColorSchemeId, 'default'>, SchemeTokens> = {
  ocean: {
    accent: '#0284c7',
    accentStrong: '#0369a1',
    accentSoft: 'rgba(2, 132, 199, 0.08)',
    accentSoftStrong: 'rgba(2, 132, 199, 0.16)',
    accentInk: '#ffffff',
    gold: '#0f766e',
    goldStrong: '#115e59',
    goldSoft: 'rgba(15, 118, 110, 0.1)',
    goldSoftStrong: 'rgba(15, 118, 110, 0.2)',
  },
  forest: {
    accent: '#059669',
    accentStrong: '#047857',
    accentSoft: 'rgba(5, 150, 105, 0.08)',
    accentSoftStrong: 'rgba(5, 150, 105, 0.16)',
    accentInk: '#ffffff',
    gold: '#65a30d',
    goldStrong: '#4d7c0f',
    goldSoft: 'rgba(101, 163, 13, 0.1)',
    goldSoftStrong: 'rgba(101, 163, 13, 0.2)',
  },
  sunset: {
    accent: '#ea580c',
    accentStrong: '#c2410c',
    accentSoft: 'rgba(234, 88, 12, 0.08)',
    accentSoftStrong: 'rgba(234, 88, 12, 0.16)',
    accentInk: '#ffffff',
    gold: '#db2777',
    goldStrong: '#be185d',
    goldSoft: 'rgba(219, 39, 119, 0.1)',
    goldSoftStrong: 'rgba(219, 39, 119, 0.2)',
  },
  sakura: {
    accent: '#e11d48',
    accentStrong: '#be123c',
    accentSoft: 'rgba(225, 29, 72, 0.08)',
    accentSoftStrong: 'rgba(225, 29, 72, 0.16)',
    accentInk: '#ffffff',
    gold: '#9333ea',
    goldStrong: '#7e22ce',
    goldSoft: 'rgba(147, 51, 234, 0.1)',
    goldSoftStrong: 'rgba(147, 51, 234, 0.2)',
  },
  arctic: {
    accent: '#0284c7',
    accentStrong: '#0369a1',
    accentSoft: 'rgba(2, 132, 199, 0.08)',
    accentSoftStrong: 'rgba(2, 132, 199, 0.16)',
    accentInk: '#ffffff',
    gold: '#475569',
    goldStrong: '#334155',
    goldSoft: 'rgba(71, 85, 105, 0.1)',
    goldSoftStrong: 'rgba(71, 85, 105, 0.2)',
  },
  amber: {
    accent: '#b45309',
    accentStrong: '#92400e',
    accentSoft: 'rgba(180, 83, 9, 0.08)',
    accentSoftStrong: 'rgba(180, 83, 9, 0.16)',
    accentInk: '#ffffff',
    gold: '#c2410c',
    goldStrong: '#9a3412',
    goldSoft: 'rgba(194, 65, 12, 0.1)',
    goldSoftStrong: 'rgba(194, 65, 12, 0.2)',
  },
  morandi: {
    accent: '#5f6d73',
    accentStrong: '#4a565b',
    accentSoft: 'rgba(95, 109, 115, 0.1)',
    accentSoftStrong: 'rgba(95, 109, 115, 0.18)',
    accentInk: '#ffffff',
    gold: '#8a726c',
    goldStrong: '#6f5a55',
    goldSoft: 'rgba(138, 114, 108, 0.1)',
    goldSoftStrong: 'rgba(138, 114, 108, 0.2)',
  },
  /* 水墨灰：宣纸 + 浓墨/重墨；辅色黛青墨 */
  inkwash: {
    accent: '#2f2d2a',
    accentStrong: '#1f1e1c',
    accentSoft: 'rgba(47, 45, 42, 0.08)',
    accentSoftStrong: 'rgba(47, 45, 42, 0.16)',
    accentInk: '#f7f4ee',
    gold: '#5c615c',
    goldStrong: '#4a4e4a',
    goldSoft: 'rgba(92, 97, 92, 0.1)',
    goldSoftStrong: 'rgba(92, 97, 92, 0.2)',
  },
}

const DEFAULT_DARK: SchemeTokens = {
  accent: '#d97757',
  accentStrong: '#e88868',
  accentSoft: 'rgba(217, 119, 87, 0.15)',
  accentSoftStrong: 'rgba(217, 119, 87, 0.3)',
  accentInk: '#1c1408',
  gold: '#d3a94a',
  goldStrong: '#e8c26a',
  goldSoft: 'rgba(211, 169, 74, 0.14)',
  goldSoftStrong: 'rgba(211, 169, 74, 0.32)',
}

const DEFAULT_LIGHT: SchemeTokens = {
  accent: '#0a0a0b',
  accentStrong: '#000000',
  accentSoft: 'rgba(0, 0, 0, 0.04)',
  accentSoftStrong: 'rgba(0, 0, 0, 0.08)',
  accentInk: '#ffffff',
  gold: '#a5751c',
  goldStrong: '#8a5f14',
  goldSoft: 'rgba(165, 117, 28, 0.1)',
  goldSoftStrong: 'rgba(165, 117, 28, 0.22)',
}

const UI_FONTS: Record<Exclude<FontFamilyId, 'default'>, string> = {
  smiley: '"SmileySans", "PingFang SC", "Microsoft YaHei", sans-serif',
  dingtalk: '"DingTalkJinBuTi", "PingFang SC", "Microsoft YaHei", sans-serif',
  wqy: '"WenQuanYi Zen Hei", "WenQuanYi Micro Hei", "文泉驿正黑", "PingFang SC", sans-serif',
}

/** 登录页强制注入配色/字体变量，避免被全局选择器优先级盖掉 */
export function loginThemeStyle(
  colorScheme: ColorSchemeId,
  uiFont: FontFamilyId,
  theme: 'dark' | 'light',
): CSSProperties {
  const tokens =
    colorScheme === 'default'
      ? theme === 'light'
        ? DEFAULT_LIGHT
        : DEFAULT_DARK
      : theme === 'light'
        ? LIGHT[colorScheme]
        : DARK[colorScheme]

  const style: Record<string, string> = {
    '--accent': tokens.accent,
    '--accent-strong': tokens.accentStrong,
    '--accent-soft': tokens.accentSoft,
    '--accent-soft-strong': tokens.accentSoftStrong,
    '--accent-ink': tokens.accentInk,
    '--gold': tokens.gold,
    '--gold-strong': tokens.goldStrong,
    '--gold-soft': tokens.goldSoft,
    '--gold-soft-strong': tokens.goldSoftStrong,
  }

  if (uiFont !== 'default') {
    style['--font-sans'] = UI_FONTS[uiFont]
  }

  return style as CSSProperties
}
