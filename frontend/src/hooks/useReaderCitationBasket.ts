import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError } from '../api/client'
import type { CitationProject } from '../api/types'
import { pickDefaultBasketProjectId } from '../lib/citationBasket'
import { copyTextToClipboard } from '../lib/clipboard'
import { BASKET_PROJECT_KEY } from '../lib/readerConstants'

export type CitationPageSource = 'print' | 'estimate' | 'virtual'

export interface ReaderCitationSelection {
  text: string
  /** EPUB cfi / PDF locator；空字符串表示无可靠定位 */
  locator: string
}

function projectFromCreated(created: { id: string; name: string }): CitationProject {
  return {
    id: created.id,
    name: created.name,
    script_variant: 'simplified',
    created_at: '',
  }
}

/**
 * 阅读器共用：引用篮列表、默认篮、页码、入篮 / 新建篮 / 快捷脚注。
 * 选区与定位由页面传入，避免绑定 EPUB/PDF 引擎细节。
 */
export function useReaderCitationBasket(opts: {
  bookId: string
  /** 解析入篮页码；可按引擎补默认页 */
  resolvePageNo: () => string
  /** 入篮成功后的 toast 文案策略（EPUB 有估算/虚拟页提示） */
  successToast?: (pageNo: string) => void
  onAfterMutate?: () => void
}) {
  const { bookId, resolvePageNo, successToast, onAfterMutate } = opts
  const [projects, setProjects] = useState<CitationProject[]>([])
  const [basketProjectId, setBasketProjectId] = useState('')
  const [basketPage, setBasketPage] = useState('')

  const loadProjects = useCallback(async () => {
    try {
      const list = await api.get<CitationProject[]>('/api/citation/projects')
      setProjects(list)
      setBasketProjectId(pickDefaultBasketProjectId(list))
      return list
    } catch {
      setProjects([])
      return [] as CitationProject[]
    }
  }, [])

  useEffect(() => {
    if (!projects.length) return
    if (!basketProjectId || !projects.some((p) => p.id === basketProjectId)) {
      setBasketProjectId(pickDefaultBasketProjectId(projects))
    }
  }, [projects, basketProjectId])

  useEffect(() => {
    if (!basketProjectId) return
    try {
      localStorage.setItem(BASKET_PROJECT_KEY, basketProjectId)
    } catch {
      /* private mode */
    }
  }, [basketProjectId])

  const ensureProjectId = useCallback(
    async (targetProjectId?: string) => {
      let projectId = targetProjectId || basketProjectId || projects[0]?.id
      if (projectId) return projectId
      try {
        const created = await api.post<{ id: string; name: string }>('/api/citation/projects', {
          name: '默认引用篮',
        })
        setProjects((prev) => [projectFromCreated(created), ...prev])
        setBasketProjectId(created.id)
        return created.id
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '无法创建引用篮项目')
        return ''
      }
    },
    [basketProjectId, projects],
  )

  const addToBasket = useCallback(
    async (selection: ReaderCitationSelection | null, targetProjectId?: string) => {
      if (!selection) return false
      const projectId = await ensureProjectId(targetProjectId)
      if (!projectId) return false
      try {
        const pageNo = resolvePageNo()
        await api.post('/api/citation/items', {
          project_id: projectId,
          book_id: bookId,
          quoted_text: selection.text,
          page_no: pageNo,
          cfi_range: selection.locator,
        })
        if (successToast) successToast(pageNo)
        else toast.success('已加入引用篮', { id: 'citation-added' })
        onAfterMutate?.()
        return true
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '存入失败')
        return false
      }
    },
    [bookId, ensureProjectId, onAfterMutate, resolvePageNo, successToast],
  )

  const addToNewBasket = useCallback(
    async (selection: ReaderCitationSelection | null, name: string) => {
      if (!selection) return false
      const trimmed = name.trim()
      if (!trimmed) {
        toast.error('请输入引用篮名称')
        return false
      }
      try {
        const created = await api.post<{ id: string; name: string }>('/api/citation/projects', {
          name: trimmed,
        })
        setProjects((prev) => [projectFromCreated(created), ...prev])
        setBasketProjectId(created.id)
        return addToBasket(selection, created.id)
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : '无法创建引用篮')
        return false
      }
    },
    [addToBasket],
  )

  const copyQuickFootnote = useCallback(async () => {
    try {
      const pageNo = resolvePageNo()
      const params = new URLSearchParams({ book_id: bookId })
      if (pageNo) params.set('page_no', pageNo)
      const { text } = await api.get<{ text: string }>(`/api/citation/quick-footnote?${params}`)
      if (!text) {
        toast.error('无法生成脚注，请先完善书籍信息')
        return
      }
      const ok = await copyTextToClipboard(text)
      if (!ok) {
        toast.error('复制失败，请长按选区使用系统复制')
        return
      }
      toast.success(pageNo ? '脚注已复制' : '脚注已复制（未填页码）')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '复制脚注失败')
    }
  }, [bookId, resolvePageNo])

  return {
    projects,
    setProjects,
    basketProjectId,
    setBasketProjectId,
    basketPage,
    setBasketPage,
    loadProjects,
    addToBasket,
    addToNewBasket,
    copyQuickFootnote,
  }
}

/** EPUB 入篮成功提示（与原先 ReaderPage 文案一致） */
export function epubCitationSuccessToast(pageNo: string, pageSource: CitationPageSource) {
  if (!pageNo) {
    toast.success('已加入引用篮', {
      id: 'citation-added',
      description: '未填页码，导出前请补纸书页',
      duration: 3400,
    })
    return
  }
  if (pageSource === 'estimate') {
    toast.success('已加入引用篮', {
      id: 'citation-added',
      description: '页码为估算，请按纸书核对',
      duration: 3400,
    })
    return
  }
  if (pageSource === 'virtual') {
    toast.success('已加入引用篮', {
      id: 'citation-added',
      description: '当前为虚拟页，请改成纸书页码',
      duration: 3400,
    })
    return
  }
  toast.success('已加入引用篮', { id: 'citation-added' })
}
