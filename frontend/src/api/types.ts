export interface BookSummary {
  id: string
  title: string
  subtitle: string
  authors: string[]
  translator: string
  publisher: string
  pub_date: string
  cover_url: string
  file_format: string
  rating: number
  tags: string[]
  readable: boolean
  added_at: string
  reading_status: 'unread' | 'reading' | 'finished'
  reading_percent: number
  last_read_at: string | null
  library_id: string | null
  library_name?: string
  douban_id?: string
  metadata_source?: string
  is_favorite?: boolean
}

export interface BookDetail extends BookSummary {
  original_title: string
  pub_place: string
  isbn: string
  series: string
  page_count: number
  language: string
  description: string
  catalog: string
  producer: string
  price: string
  binding: string
  douban_id: string
  google_books_id: string
  metadata_source: string
  metadata_locked: boolean
  file_size: number
}

export interface Highlight {
  id: string
  book_id: string
  cfi_range: string
  color: string
  quoted_text: string
  note: string
  chapter_title: string
  page_no: string
  created_at: string
  updated_at: string
}

export interface CitationProject {
  id: string
  name: string
  script_variant: 'simplified' | 'traditional'
  created_at: string
  item_count?: number
}

export interface CitationItem {
  id: string
  project_id: string
  book_id: string
  book_title: string
  book_authors: string[]
  book_cover_url: string
  quoted_text: string
  page_no: string
  cfi_range?: string
  group_name: string
  order_index: number
  created_at: string
}

export interface BookNote {
  book_id: string
  content: string
  updated_at: string | null
}

/** 首页「摘录与引用」：引用篮 / 高亮，用 kind 区分 */
export interface HomeSnippet {
  kind: 'citation' | 'highlight'
  id: string
  project_id: string
  /** 引用篮名称；高亮条目为空 */
  project_name?: string
  book_id: string
  book_title: string
  file_format?: string
  cover_url: string
  quoted_text: string
  page_no: string
  group_name: string
  note: string
  chapter_title: string
  color: string
  cfi_range: string
  highlight_id: string
  created_at: string
}

export interface HomeFeed {
  continue_reading: BookSummary[]
  recent: BookSummary[]
  recent_snippets?: HomeSnippet[]
}

export interface DailyQuote {
  id: string
  book_id: string
  book_title: string
  book_format: string
  quoted_text: string
  cfi_range: string
  page_no: string
}

export interface GlobalSearchBookHit {
  id: string
  title: string
  subtitle: string
  authors: string[]
  cover_url: string
  file_format: string
  reading_status?: 'unread' | 'reading' | 'finished'
}

export interface GlobalSearchHighlightHit {
  id: string
  book_id: string
  book_title: string
  cover_url?: string
  cfi_range: string
  quoted_text: string
  note: string
  chapter_title: string
  color: string
}

export interface GlobalSearchCitationHit {
  id: string
  project_id: string
  project_name: string
  book_id: string
  book_title: string
  cover_url?: string
  quoted_text: string
  group_name: string
  page_no: string
}

export interface GlobalSearchFulltextHit {
  book_id: string
  book_title: string
  cover_url?: string
  chapter_title: string
  cfi_anchor: string
  snippet: string
}

export interface GlobalSearchResult {
  books: GlobalSearchBookHit[]
  highlights: GlobalSearchHighlightHit[]
  citations: GlobalSearchCitationHit[]
  fulltext: GlobalSearchFulltextHit[]
}

export interface Tag {
  id: string
  name: string
  source: string
  book_count: number
  order_index?: number
}

export interface Collection {
  id: string
  name: string
  is_smart: boolean
  smart_query: string
  book_count: number
  order_index?: number
}

export interface Library {
  id: string
  name: string
  root_path: string
  scan_mode: string
  last_scanned_at: string | null
  book_count: number
  order_index?: number
}

export interface BrowseEntry {
  name: string
  path: string
}

export interface BrowseResult {
  mount_root: string
  mount_ready: boolean
  path: string
  parent: string | null
  absolute_path: string
  entries: BrowseEntry[]
  permission_denied?: boolean
}

export interface AdminUser {
  id: string
  username: string
  display_name: string
  role: 'admin' | 'reader'
  disabled: boolean
  created_at: string
  last_login_at: string | null
}

export interface MetadataCandidate {
  source: 'douban' | 'google'
  douban_id?: string
  google_books_id?: string
  title: string
  subtitle?: string
  cover_url?: string
  pub_date?: string
  authors?: string[]
  translator?: string
  publisher?: string
  rating?: number
  /** 后端匹配分，越高越靠前 */
  _match_score?: number
}

export interface MetadataSourceStatus {
  ok: boolean
  count: number
  error?: string | null
  enabled?: boolean
  has_api_key?: boolean
}

export interface MetadataSearchResponse {
  results: MetadataCandidate[]
  sources: {
    douban: MetadataSourceStatus
    google: MetadataSourceStatus
  }
  parsed_title?: string
  parsed_authors?: string[]
  search_query?: string
  /** Google 实际使用的查询词（搜索框原文） */
  google_query?: string
  /** api = 官方相关度顺序，未做本地打分 */
  google_ranking?: 'api' | string
}

// ── AI 伴读 ────────────────────────────────────────────────────────────────

export interface AiProvider {
  key: string
  name: string
  base_url: string
  has_balance: boolean
  recommended: boolean
  signup_url: string
  models: string[]
}

export interface AiConfig {
  has_key: boolean
  base_url: string
  api_key_masked: string
  api_key?: string
  model: string
  output_lang: string
  output_length: string
  ai_portrait: AiPortrait
  provider: string
}

export interface AiPortrait {
  reading_style: string
  output_tone: string
  focus_areas: string[]
  extra_prompt: string
}

export interface AiReaderBook {
  id: string
  title: string
  authors: string[]
  cover_url: string
  file_format: string
  reading_status: 'unread' | 'reading' | 'finished'
  highlight_count: number
  has_note: boolean
  citation_count: number
}


export interface AiHighlight {
  id?: string
  text: string
  note: string
  chapter: string
}

export interface AiCitation {
  id?: string
  text: string
  group: string
}

export interface AiMaterial {
  id: string
  title: string
  authors: string[]
  cover_url: string
  file_format: string
  highlights: AiHighlight[]
  note_content: string
  note_id?: string
  citations: AiCitation[]
  has_full_text_index: boolean
  used_full_text: boolean
  full_text_chapters: { index: number; title: string; text: string }[]
}

export type AiReportFieldValue =
  | string
  | number
  | boolean
  | null
  | AiReportFieldValue[]
  | { [key: string]: AiReportFieldValue }

export interface AiReportContent {
  raw?: string
  content_summary?: AiReportFieldValue
  /** 常为「要点/论证/我的思考」对象数组；历史数据也可能是纯字符串 */
  core_insights?: AiReportFieldValue
  personal_reflections?: AiReportFieldValue
  knowledge_map?: AiReportFieldValue
  reading_advice?: AiReportFieldValue
  similar_books?: Array<{ title: string; author?: string; reason: string }>
  quotable_passages?: Array<{ text: string; context?: string }>
  book_summary_for_citation?: string
}

export interface AiReport {
  id: string
  book_ids: string[]
  report: AiReportContent
  chat_history?: { role: string; content: string }[]
  generated_at: string
}

