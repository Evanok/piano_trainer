import type { CatalogEntry, CatalogPage, ScoreDifficulty } from '../src/types/catalog.ts'

export const DEFAULT_PAGE_SIZE = 10
// Only a guard against a hand-crafted ?limit=999999 -- the UI never asks for
// more than DEFAULT_PAGE_SIZE.
export const MAX_PAGE_SIZE = 50

export interface CatalogQuery {
  search?: string
  /** Exact match, not a search term -- an entry with no difficulty set never
   *  matches any of the three values, it only shows up with no filter applied. */
  difficulty?: ScoreDifficulty
  page?: number
  pageSize?: number
}

function matchesSearch(entry: CatalogEntry, terms: string[]): boolean {
  const haystack = `${entry.title} ${entry.composer ?? ''} ${entry.filename}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function clampPageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isFinite(pageSize) || pageSize < 1) {
    return DEFAULT_PAGE_SIZE
  }
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE)
}

/**
 * Pure search + pagination over the whole catalog: every term must match
 * (AND), case-insensitively, against the title, the composer or the file name;
 * results come back most recently uploaded first.
 */
export function queryCatalog(entries: CatalogEntry[], query: CatalogQuery = {}): CatalogPage {
  const terms = (query.search ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const bySearch = terms.length > 0 ? entries.filter((entry) => matchesSearch(entry, terms)) : [...entries]
  const matched = query.difficulty ? bySearch.filter((entry) => entry.difficulty === query.difficulty) : bySearch

  // ISO-8601 strings compare lexicographically in chronological order, so no
  // Date parsing is needed. Two uploads can land in the same millisecond, so
  // fall back to the id to keep the order (and therefore paging) stable.
  matched.sort((a, b) =>
    a.uploadedAt === b.uploadedAt ? a.id.localeCompare(b.id) : b.uploadedAt.localeCompare(a.uploadedAt),
  )

  const pageSize = clampPageSize(query.pageSize)
  // Always at least one page, so an empty catalog still reports "page 1 of 1"
  // rather than "page 1 of 0".
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize))
  const requestedPage = Number.isFinite(query.page) ? Math.floor(query.page as number) : 1
  const page = Math.min(Math.max(1, requestedPage), pageCount)
  const start = (page - 1) * pageSize

  return {
    items: matched.slice(start, start + pageSize),
    total: matched.length,
    page,
    pageCount,
    pageSize,
  }
}
