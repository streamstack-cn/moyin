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
  group_name: string
  order_index: number
  created_at: string
}

export interface BookNote {
  book_id: string
  content: string
  updated_at: string | null
}

export interface HomeFeed {
  continue_reading: BookSummary[]
  recent: BookSummary[]
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
  quoted_text: string
  group_name: string
  page_no: string
}

export interface GlobalSearchFulltextHit {
  book_id: string
  book_title: string
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
}

export interface Collection {
  id: string
  name: string
  is_smart: boolean
  smart_query: string
  book_count: number
}

export interface Library {
  id: string
  name: string
  root_path: string
  scan_mode: string
  last_scanned_at: string | null
  book_count: number
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
}
