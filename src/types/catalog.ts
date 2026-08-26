// Shared by the browser (src/api/catalog.ts) and the server (server/*.ts) --
// this file is the single source of truth for the catalog wire format.

import type { ScorePlayProgress } from '../engine/scoreProgress.ts'

/** User-assigned only -- nothing in a MusicXML file states how hard it is to play. */
export type ScoreDifficulty = 'easy' | 'medium' | 'hard'

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
  /** Optional so entries saved before this field existed decode without it -- treat missing the same as null (not set). */
  difficulty?: ScoreDifficulty | null
  /** User-assigned too: the handful of pieces currently being worked on.
   *  Optional for the same reason as difficulty -- missing means not a favorite. */
  favorite?: boolean
  /**
   * How far this piece has been practised, joined onto the listing from the
   * shared practice history. Derived, never stored in catalog.json: it changes
   * every time the piece is played, and persisting it would only be a copy that
   * can go stale. Absent (and null) mean "never practised".
   */
  progress?: ScorePlayProgress | null
}

/**
 * How the listing is ordered. The last three read the practice history rather
 * than the catalog itself, which is why the sort has to happen server-side:
 * sorting the ten entries of the current page would only shuffle that page.
 */
export type CatalogSort = 'recent' | 'title' | 'lastPlayed' | 'progress' | 'played'

export const CATALOG_SORTS: CatalogSort[] = ['recent', 'title', 'lastPlayed', 'progress', 'played']

export const DEFAULT_CATALOG_SORT: CatalogSort = 'recent'

/**
 * How the catalog is currently being browsed. Not part of the wire format: it
 * lives here because App owns it (so it survives ScoreLibrary unmounting) while
 * ScoreLibrary is what changes it, and one object means adding a control is one
 * field rather than another argument threaded between the two.
 */
export interface CatalogBrowseState {
  search: string
  difficulty: ScoreDifficulty | ''
  favoritesOnly: boolean
  sort: CatalogSort
  page: number
}

export const DEFAULT_BROWSE_STATE: CatalogBrowseState = {
  search: '',
  difficulty: '',
  favoritesOnly: false,
  sort: DEFAULT_CATALOG_SORT,
  page: 1,
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
