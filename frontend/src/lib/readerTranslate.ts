import { apiRequest, ApiError } from '../api/client'

export type TranslateMode = 'word' | 'sentence'

export interface TranslateResult {
  text: string
  translation: string
  target_lang: string
  mode: TranslateMode
  provider: string
  provider_detail?: string
  cached?: boolean
}

export interface ExplainResult {
  text: string
  explanation: string
  question: string
}

export type BubbleTranslateStatus = 'idle' | 'loading' | 'done' | 'error'

export interface BubbleTranslateState {
  status: BubbleTranslateStatus
  translation: string
  provider?: string
  mode?: TranslateMode
  error?: string
  sourceText?: string
}

export const IDLE_BUBBLE_TRANSLATE: BubbleTranslateState = {
  status: 'idle',
  translation: '',
}

/** 拉丁字母占比高才自动请求（纯中文跳过） */
export function looksLikeLatinSource(text: string): boolean {
  const letters = Array.from(text).filter((c) => /\p{L}/u.test(c))
  if (letters.length === 0) return false
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length
  return latin / letters.length >= 0.55
}

export function providerLabel(provider?: string): string {
  if (provider === 'ai') return 'AI'
  if (provider === 'free') return '词典'
  return provider || ''
}

export async function translateSelection(
  text: string,
  opts?: { targetLang?: string; mode?: 'auto' | TranslateMode; signal?: AbortSignal },
): Promise<TranslateResult> {
  return apiRequest<TranslateResult>('/api/reader/translate', {
    method: 'POST',
    body: JSON.stringify({
      text,
      target_lang: opts?.targetLang || 'zh',
      mode: opts?.mode || 'auto',
    }),
    signal: opts?.signal,
  })
}

export async function explainSelection(body: {
  text: string
  translation?: string
  question?: string
  signal?: AbortSignal
}): Promise<ExplainResult> {
  return apiRequest<ExplainResult>('/api/reader/translate/explain', {
    method: 'POST',
    body: JSON.stringify({
      text: body.text,
      translation: body.translation || '',
      question: body.question || '',
    }),
    signal: body.signal,
  })
}

export function translateErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || '翻译失败'
  if (err instanceof DOMException && err.name === 'AbortError') return ''
  if (err instanceof Error) return err.message || '翻译失败'
  return '翻译失败'
}
