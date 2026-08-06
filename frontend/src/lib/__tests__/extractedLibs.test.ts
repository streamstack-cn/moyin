import { describe, expect, it } from 'vitest'
import { pickDefaultBasketProjectId } from '../citationBasket'
import {
  findChapterTitle,
  flattenToc,
  joinEpubHref,
} from '../epubNav'
import { buildBookSections } from '../librarySections'
import { pageHasSelectableText } from '../pdfTextLayer'
import { resolveReaderTheme } from '../readerTheme'
import { epubPersistableLocator, pdfPersistableLocator } from '../readerSelection'
import type { BookSummary, CitationProject, Library, Tag } from '../../api/types'
import type { NavItem } from 'epubjs/types/navigation'

describe('citationBasket', () => {
  it('falls back to default basket name then first project', () => {
    const projects = [
      { id: 'a', name: '其他' },
      { id: 'b', name: '默认引用篮' },
    ] as CitationProject[]
    expect(pickDefaultBasketProjectId(projects)).toBe('b')
  })
})

describe('epubNav', () => {
  it('flattens nested toc', () => {
    const toc = [
      { id: '1', label: '一', href: 'a.xhtml', subitems: [{ id: '1-1', label: '一·1', href: 'b.xhtml', subitems: [] }] },
    ] as NavItem[]
    expect(flattenToc(toc).map((x) => x.depth)).toEqual([0, 1])
    expect(findChapterTitle(toc, 'b.xhtml#x')).toBe('一·1')
  })

  it('joins relative href with parent dirs', () => {
    expect(joinEpubHref('OEBPS/Text/', '../Styles/x.css')).toBe('OEBPS/Styles/x.css')
    expect(joinEpubHref('OEBPS/', 'epubcfi(/6/4)')).toBe('epubcfi(/6/4)')
  })
})

describe('readerTheme', () => {
  it('resolves preset and custom luminance', () => {
    expect(resolveReaderTheme('paper', '#000')).toEqual({ bg: '#f4ecd8', fg: '#2b2620' })
    expect(resolveReaderTheme('custom', '#ffffff').fg).toBe('#2b2620')
    expect(resolveReaderTheme('custom', '#000000').fg).toBe('#e8e3d8')
  })
})

describe('pdfTextLayer', () => {
  it('requires at least two meaningful chars', () => {
    expect(pageHasSelectableText([{ str: ' ' }, { str: '1' }])).toBe(false)
    expect(pageHasSelectableText([{ str: 'ab' }])).toBe(true)
    expect(pageHasSelectableText([{ str: '\u200b' }, { str: '字' }, { str: '词' }])).toBe(true)
  })
})

describe('readerSelection', () => {
  it('drops mobile ephemeral epub locators', () => {
    expect(epubPersistableLocator('mobile-abc')).toBe('')
    expect(epubPersistableLocator('epubcfi(/6/4)')).toBe('epubcfi(/6/4)')
  })

  it('falls back pdf locator to page', () => {
    expect(pdfPersistableLocator('', 3)).toBe('pdf:#page=3')
    expect(pdfPersistableLocator('pdf:#page=9&x=1', 3)).toBe('pdf:#page=9&x=1')
  })
})

describe('librarySections', () => {
  const libs = [
    { id: 'L1', name: '书架甲', order_index: 1 },
    { id: 'L2', name: '书架乙', order_index: 0 },
  ] as Library[]
  const tags = [{ id: 't1', name: '哲学' }] as Tag[]
  const books = [
    { id: '1', title: 'A', library_id: 'L1', tags: ['哲学'] },
    { id: '2', title: 'B', library_id: null, tags: [] },
  ] as unknown as BookSummary[]

  it('groups by shelf order and unassigned', () => {
    const sections = buildBookSections(books, 'shelf', libs, tags)
    // 空书架不生成分区；有书的 L1 在前，未归架在后
    expect(sections.map((s) => s.key)).toEqual(['shelf:L1', 'shelf:none'])
    expect(sections.find((s) => s.key === 'shelf:none')?.books).toHaveLength(1)
  })

  it('returns empty for flat mode', () => {
    expect(buildBookSections(books, 'flat', libs, tags)).toEqual([])
  })
})
