import { useCallback, useEffect, useRef, useState } from 'react'
import {
  explainSelection,
  IDLE_BUBBLE_TRANSLATE,
  looksLikeLatinSource,
  translateErrorMessage,
  translateSelection,
  type BubbleTranslateState,
  type TranslateResult,
} from '../lib/readerTranslate'

export interface TranslatePanelEntry {
  text: string
  translation: string
  provider?: string
  mode?: string
  explanation?: string
  explainError?: string
  explaining?: boolean
}

const DEBOUNCE_MS = 260

export function useReaderSelectionTranslate(selectionText: string | null | undefined, autoEnabled: boolean) {
  const [bubble, setBubble] = useState<BubbleTranslateState>(IDLE_BUBBLE_TRANSLATE)
  const [panel, setPanel] = useState<TranslatePanelEntry | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const explainAbortRef = useRef<AbortController | null>(null)
  const reqSeq = useRef(0)
  const panelRef = useRef<TranslatePanelEntry | null>(null)
  panelRef.current = panel

  const cancelInFlight = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const resetBubble = useCallback(() => {
    cancelInFlight()
    reqSeq.current += 1
    setBubble(IDLE_BUBBLE_TRANSLATE)
  }, [cancelInFlight])

  const applyResult = useCallback((result: TranslateResult) => {
    setBubble({
      status: 'done',
      translation: result.translation,
      provider: result.provider,
      mode: result.mode,
      sourceText: result.text,
    })
    setPanel((prev) => ({
      text: result.text,
      translation: result.translation,
      provider: result.provider,
      mode: result.mode,
      explanation: prev?.text === result.text ? prev.explanation : undefined,
      explainError: undefined,
      explaining: false,
    }))
  }, [])

  const runTranslate = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      cancelInFlight()
      const seq = ++reqSeq.current
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setBubble({ status: 'loading', translation: '', sourceText: trimmed })
      try {
        const result = await translateSelection(trimmed, { signal: ctrl.signal })
        if (seq !== reqSeq.current) return
        applyResult(result)
      } catch (err) {
        if (seq !== reqSeq.current) return
        const msg = translateErrorMessage(err)
        if (!msg) return
        setBubble({ status: 'error', translation: '', error: msg, sourceText: trimmed })
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null
      }
    },
    [applyResult, cancelInFlight],
  )

  // 选区变化：自动翻译（可关）；切换选区取消上一次
  useEffect(() => {
    const text = (selectionText || '').trim()
    if (!text) {
      resetBubble()
      return
    }
    // 选区文本变了，先清旧译文，避免串台
    setBubble(IDLE_BUBBLE_TRANSLATE)
    cancelInFlight()
    if (!autoEnabled || !looksLikeLatinSource(text)) return

    const timer = window.setTimeout(() => {
      void runTranslate(text)
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      cancelInFlight()
    }
  }, [selectionText, autoEnabled, cancelInFlight, resetBubble, runTranslate])

  const translateNow = useCallback(() => {
    const text = (selectionText || '').trim()
    if (!text) return
    void runTranslate(text)
  }, [runTranslate, selectionText])

  const openPanelFromBubble = useCallback(() => {
    const text = (selectionText || bubble.sourceText || '').trim()
    if (!text) return
    setPanel((prev) => ({
      text,
      translation: bubble.translation || prev?.translation || '',
      provider: bubble.provider || prev?.provider,
      mode: bubble.mode || prev?.mode,
      explanation: prev?.text === text ? prev.explanation : undefined,
      explainError: undefined,
      explaining: false,
    }))
  }, [bubble, selectionText])

  const askExplain = useCallback(async (question?: string) => {
    const current = panelRef.current
    if (!current?.text) return
    setPanel((prev) => (prev ? { ...prev, explaining: true, explainError: undefined } : prev))
    explainAbortRef.current?.abort()
    const ctrl = new AbortController()
    explainAbortRef.current = ctrl
    try {
      const result = await explainSelection({
        text: current.text,
        translation: current.translation,
        question,
        signal: ctrl.signal,
      })
      setPanel((prev) =>
        prev && prev.text === current.text
          ? { ...prev, explanation: result.explanation, explaining: false, explainError: undefined }
          : prev,
      )
    } catch (err) {
      const msg = translateErrorMessage(err)
      if (!msg) return
      setPanel((prev) => (prev ? { ...prev, explaining: false, explainError: msg } : prev))
    } finally {
      if (explainAbortRef.current === ctrl) explainAbortRef.current = null
    }
  }, [])

  return {
    bubble,
    panel,
    setPanel,
    translateNow,
    resetBubble,
    openPanelFromBubble,
    askExplain,
  }
}
