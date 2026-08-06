import type { CitationProject } from '../api/types'
import { BASKET_PROJECT_KEY } from './readerConstants'

/** 优先恢复本机上次选用的引用篮，否则回落到「默认引用篮」或列表首项 */
export function pickDefaultBasketProjectId(projects: CitationProject[]): string {
  try {
    const saved = localStorage.getItem(BASKET_PROJECT_KEY)
    if (saved && projects.some((p) => p.id === saved)) return saved
  } catch {
    /* private mode */
  }
  return projects.find((p) => p.name === '默认引用篮')?.id || projects[0]?.id || ''
}
