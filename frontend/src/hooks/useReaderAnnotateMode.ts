import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * 移动端划词模式：选区出现时进入、超时退出、顶栏钉住开关。
 * 引擎相关的轮询（同步选区 / present）仍由页面注入，避免绑死 EPUB/PDF。
 */
export function useReaderAnnotateMode(opts: {
  hasSelection: boolean
  isCompact: boolean
  onSelectionShowChrome?: () => void
}) {
  const { hasSelection, isCompact, onSelectionShowChrome } = opts
  const [midSelectMode, setMidSelectMode] = useState(false)
  const midSelectPinnedRef = useRef(false)

  useEffect(() => {
    if (hasSelection) setMidSelectMode(true)
  }, [hasSelection])

  useEffect(() => {
    if (hasSelection && isCompact) onSelectionShowChrome?.()
  }, [hasSelection, isCompact, onSelectionShowChrome])

  useEffect(() => {
    if (hasSelection || !midSelectMode || midSelectPinnedRef.current) return
    const t = window.setTimeout(() => setMidSelectMode(false), 8000)
    return () => window.clearTimeout(t)
  }, [hasSelection, midSelectMode])

  const enterAnnotateMode = useCallback((enterOpts?: { pinned?: boolean; toast?: boolean }) => {
    setMidSelectMode(true)
    if (enterOpts?.pinned) midSelectPinnedRef.current = true
    if (enterOpts?.toast !== false) {
      toast.message('划词已开启：请再长按文字拖选', {
        id: 'moyin-annotate-mode',
        duration: 2200,
        icon: null,
      })
    }
  }, [])

  const exitAnnotateMode = useCallback(() => {
    midSelectPinnedRef.current = false
    setMidSelectMode(false)
  }, [])

  const toggleAnnotateMode = useCallback(() => {
    if (midSelectMode && midSelectPinnedRef.current) {
      exitAnnotateMode()
      return
    }
    if (midSelectMode && !hasSelection) {
      exitAnnotateMode()
      return
    }
    enterAnnotateMode({ pinned: true })
  }, [enterAnnotateMode, exitAnnotateMode, hasSelection, midSelectMode])

  return {
    midSelectMode,
    setMidSelectMode,
    midSelectPinnedRef,
    enterAnnotateMode,
    exitAnnotateMode,
    toggleAnnotateMode,
  }
}
