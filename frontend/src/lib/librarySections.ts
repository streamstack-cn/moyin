import type { BookSummary, Library, Tag } from '../api/types'

export type LibraryGroupMode = 'shelf' | 'tag' | 'flat'

export interface LibraryBookSection {
  key: string
  title: string
  hint?: string
  books: BookSummary[]
}

export function buildBookSections(
  books: BookSummary[],
  mode: LibraryGroupMode,
  libraries: Library[],
  tags: Tag[],
): LibraryBookSection[] {
  if (mode === 'flat' || books.length === 0) return []

  if (mode === 'shelf') {
    const libMap = new Map(libraries.map((l) => [l.id, l]))
    const byLib = new Map<string, BookSummary[]>()
    const unassigned: BookSummary[] = []
    for (const book of books) {
      if (book.library_id && libMap.has(book.library_id)) {
        const list = byLib.get(book.library_id) || []
        list.push(book)
        byLib.set(book.library_id, list)
      } else {
        unassigned.push(book)
      }
    }
    const sections: LibraryBookSection[] = []
    const sortedLibraries = [...libraries].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    for (const lib of sortedLibraries) {
      const list = byLib.get(lib.id)
      if (!list?.length) continue
      sections.push({
        key: `shelf:${lib.id}`,
        title: lib.name,
        books: list,
      })
    }
    // 已删除书架但仍挂着 library_id 的书
    for (const [id, list] of byLib) {
      if (libMap.has(id) || !list.length) continue
      sections.push({
        key: `shelf:${id}`,
        title: '未知书架',
        books: list,
      })
    }
    if (unassigned.length) {
      sections.push({
        key: 'shelf:none',
        title: '未归架',
        hint: '上传入库或尚未归入书架的书',
        books: unassigned,
      })
    }
    return sections
  }

  // 按标签：一书可出现在多个标签下
  const byTag = new Map<string, BookSummary[]>()
  const untagged: BookSummary[] = []
  for (const book of books) {
    if (!book.tags?.length) {
      untagged.push(book)
      continue
    }
    for (const tag of book.tags) {
      const list = byTag.get(tag) || []
      list.push(book)
      byTag.set(tag, list)
    }
  }
  const tagOrder = tags.map((t) => t.name)
  const sections: LibraryBookSection[] = []
  for (const name of tagOrder) {
    const list = byTag.get(name)
    if (!list?.length) continue
    sections.push({ key: `tag:${name}`, title: name, books: list })
    byTag.delete(name)
  }
  for (const [name, list] of [...byTag.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    if (!list.length) continue
    sections.push({ key: `tag:${name}`, title: name, books: list })
  }
  if (untagged.length) {
    sections.push({
      key: 'tag:none',
      title: '未打标签',
      hint: '可在书籍详情中匹配元数据或编辑标签',
      books: untagged,
    })
  }
  return sections
}
