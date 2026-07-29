// Shared by the browser (src/api/catalog.ts) and the server (server/*.ts) --
// this file is the single source of truth for the catalog wire format.

export interface CatalogEntry {
  id: string
  /** Display name, derived from the uploaded file name (extension stripped). */
  title: string
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
