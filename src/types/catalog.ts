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
   * The catalog's virtual folders (see `src/engine/tags.ts`): a view, not a
   * location, so one score can sit in several. Optional for the same reason as
   * difficulty -- entries written before tags existed decode without it, and
   * missing means "in no folder", which the startup migration then fills in
   * with `personal`.
   */
  tags?: string[]
  /**
   * Identifier of the score in the library it was harvested from (a PianoML
   * score id), set by `tools/import-library.mjs` and absent on anything the
   * player uploaded. It is the only stable identity across collections: the same
   * PianoML score reaches two collections under two different titles, so an
   * importer keyed on the title alone files it twice.
   */
  sourceId?: string
  /**
   * The score's opening key signature as MusicXML counts it: sharps positive,
   * flats negative, 0 for none. Read from the file at upload (and backfilled
   * by the startup migration), never edited. Null when the file states none,
   * absent on an entry not yet backfilled; both mean "unknown", which only
   * ever matches the unfiltered listing.
   */
  keyFifths?: number | null
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
 * The key signature filter: HOW MANY sharps or flats, either kind. The number
 * is what makes a page harder to read -- two sharps and two flats ask the same
 * effort -- and a filter by key name ("si minor") cannot be offered at all,
 * since a file almost never says which of its signature's two keys it is in.
 * `4+` lumps the rest together because the catalog holds very few of them.
 */
export type CatalogKeyFilter = '0' | '1' | '2' | '3' | '4+'

export const CATALOG_KEY_FILTERS: CatalogKeyFilter[] = ['0', '1', '2', '3', '4+']

/** Whether a score's signature falls in a key filter; unknown never does. */
export function matchesKeyFilter(keyFifths: number | null | undefined, filter: CatalogKeyFilter): boolean {
  if (typeof keyFifths !== 'number') {
    return false
  }
  const count = Math.abs(keyFifths)
  return filter === '4+' ? count >= 4 : count === Number(filter)
}

/**
 * "2 flats", "1 sharp", '' for none: a signature as a badge writes it. In
 * words rather than "2♭", because UI fonts draw the flat sign at a fraction of
 * the sharp's size and it was unreadable at badge size.
 */
export function keySignatureBadge(keyFifths: number | null | undefined): string {
  if (typeof keyFifths !== 'number' || keyFifths === 0) {
    return ''
  }
  const count = Math.abs(keyFifths)
  return `${count} ${keyFifths > 0 ? 'sharp' : 'flat'}${count > 1 ? 's' : ''}`
}

/**
 * How the catalog is currently being browsed. Not part of the wire format: it
 * lives here because App owns it (so it survives ScoreLibrary unmounting) while
 * ScoreLibrary is what changes it, and one object means adding a control is one
 * field rather than another argument threaded between the two.
 */
export interface CatalogBrowseState {
  search: string
  difficulty: ScoreDifficulty | ''
  keySignature: CatalogKeyFilter | ''
  favoritesOnly: boolean
  /** Selected virtual folder, '' for "all scores". Matches its descendants too. */
  tag: string
  sort: CatalogSort
  page: number
}

export const DEFAULT_BROWSE_STATE: CatalogBrowseState = {
  search: '',
  difficulty: '',
  keySignature: '',
  favoritesOnly: false,
  tag: '',
  sort: DEFAULT_CATALOG_SORT,
  page: 1,
}

export interface CatalogPage {
  items: CatalogEntry[]
  /** Number of entries matching the search, across every page. */
  total: number
  /**
   * Entries matching every active filter *except* the tag one: what the tree's
   * "all scores" row shows. `total` is after the folder filter, so it would
   * otherwise report the selected folder's own count as the whole catalog's.
   */
  totalAcrossFolders: number
  /**
   * How many entries each tag holds, its descendants included, under every
   * active filter *except* the tag one -- the faceted-search rule: counting with
   * the tag filter applied would zero every sibling the moment one is selected,
   * and the tree would stop answering "where are my easy favorites?".
   */
  tagCounts: Record<string, number>
  /** 1-based, already clamped to [1, pageCount] by the server. */
  page: number
  pageCount: number
  pageSize: number
}
