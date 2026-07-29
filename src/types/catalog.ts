// Shared by the browser (src/api/catalog.ts) and the server (server/*.ts) --
// this file is the single source of truth for the catalog wire format.

export interface CatalogEntry {
  id: string
  /** The score's own <work-title>, or a readable form of the file name. */
  title: string
  /** The score's <creator type="composer">, null when it has none. */
  composer: string | null
  /** Original file name, kept for its extension and as a search fallback. */
  filename: string
  sizeBytes: number
  /** ISO-8601, UTC. */
  uploadedAt: string
}

export interface CatalogPage {
  items: CatalogEntry[]
  /** Number of entries matching the search, across every page. */
  total: number
  /** 1-based, already clamped to [1, pageCount] by the server. */
  page: number
  pageCount: number
  pageSize: number
}
