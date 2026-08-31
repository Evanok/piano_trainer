import type { CatalogEntry, CatalogPage, CatalogSort, ScoreDifficulty } from '../src/types/catalog.ts'
import type { ScorePlayProgress } from '../src/engine/scoreProgress.ts'
import { countTags, entryMatchesTag } from '../src/engine/tags.ts'

export const DEFAULT_PAGE_SIZE = 10
// Only a guard against a hand-crafted ?limit=999999 -- the UI never asks for
// more than DEFAULT_PAGE_SIZE.
export const MAX_PAGE_SIZE = 50

export interface CatalogQuery {
  search?: string
  /** Exact match, not a search term -- an entry with no difficulty set never
   *  matches any of the three values, it only shows up with no filter applied. */
  difficulty?: ScoreDifficulty
  /** When true, keep only the starred entries; false and undefined both mean
   *  "no filter" (there is deliberately no "non-favorites only" option). */
  favoritesOnly?: boolean
  /** Virtual folder to restrict to, descendants included (`study` keeps
   *  `study/bartok`). Empty and undefined both mean "every folder". */
  tag?: string
  /** Defaults to 'recent' (most recently uploaded first), the historical order. */
  sort?: CatalogSort
  /**
   * Practice history joined in by id (server/statsStore.ts). Entries missing
   * from it have never been practised: they get no progress on the listing and
   * sort last under every play-based order.
   */
  progress?: Map<string, ScorePlayProgress>
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
 * Most recently uploaded first, the catalog's own order and every other sort's
 * tie-break. ISO-8601 strings compare lexicographically in chronological order,
 * so no Date parsing is needed; two uploads can land in the same millisecond, so
 * the id breaks that tie and keeps paging stable.
 */
function byRecent(a: CatalogEntry, b: CatalogEntry): number {
  return a.uploadedAt === b.uploadedAt ? a.id.localeCompare(b.id) : b.uploadedAt.localeCompare(a.uploadedAt)
}

/**
 * Every sort ends in `byRecent`, so entries the sort cannot tell apart (two
 * unplayed pieces under "highest progress", say) still come back in one stable
 * order rather than drifting between pages on successive requests.
 */
function comparatorFor(
  sort: CatalogSort,
  progressOf: (entry: CatalogEntry) => ScorePlayProgress | undefined,
): (a: CatalogEntry, b: CatalogEntry) => number {
  switch (sort) {
    case 'title':
      // Locale-aware and case-insensitive, so "elise" sorts next to "Elise"
      // and accented titles land where a French reader expects them. `numeric`
      // is what makes a study collection readable: without it "No. 10" sorts
      // before "No. 2", so a folder of numbered etudes comes back shuffled.
      return (a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || byRecent(a, b)
    case 'lastPlayed':
      return (a, b) => {
        const left = progressOf(a)?.lastPlayedAt ?? ''
        const right = progressOf(b)?.lastPlayedAt ?? ''
        return left === right ? byRecent(a, b) : right.localeCompare(left)
      }
    case 'progress':
      return (a, b) => (progressOf(b)?.percent ?? -1) - (progressOf(a)?.percent ?? -1) || byRecent(a, b)
    case 'played':
      return (a, b) => (progressOf(b)?.sessionCount ?? 0) - (progressOf(a)?.sessionCount ?? 0) || byRecent(a, b)
    case 'recent':
    default:
      return byRecent
  }
}

/**
 * Pure search + pagination over the whole catalog: every term must match
 * (AND), case-insensitively, against the title, the composer or the file name;
 * the difficulty, favorite and tag filters then narrow that down (AND again),
 * and results come back in `sort` order (most recently uploaded first by
 * default).
 *
 * Sorting happens here, before pagination, which is the whole reason the
 * play-based orders need the history passed in rather than being applied by the
 * front-end: reordering the ten entries of one page is not sorting a catalog.
 */
export function queryCatalog(entries: CatalogEntry[], query: CatalogQuery = {}): CatalogPage {
  const terms = (query.search ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const bySearch = terms.length > 0 ? entries.filter((entry) => matchesSearch(entry, terms)) : [...entries]
  const byDifficulty = query.difficulty ? bySearch.filter((entry) => entry.difficulty === query.difficulty) : bySearch
  const byFavorite = query.favoritesOnly ? byDifficulty.filter((entry) => entry.favorite === true) : byDifficulty
  // Counted before the tag filter is applied, and only after it for the listing:
  // the tree has to keep showing what the *other* filters left in each folder.
  const tagCounts = countTags(byFavorite)
  const matched = query.tag ? byFavorite.filter((entry) => entryMatchesTag(entry.tags, query.tag as string)) : byFavorite

  const progressOf = (entry: CatalogEntry): ScorePlayProgress | undefined => query.progress?.get(entry.id)
  matched.sort(comparatorFor(query.sort ?? 'recent', progressOf))

  const pageSize = clampPageSize(query.pageSize)
  // Always at least one page, so an empty catalog still reports "page 1 of 1"
  // rather than "page 1 of 0".
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize))
  const requestedPage = Number.isFinite(query.page) ? Math.floor(query.page as number) : 1
  const page = Math.min(Math.max(1, requestedPage), pageCount)
  const start = (page - 1) * pageSize

  return {
    // Copied, never mutated in place: these are the very objects catalog.json
    // was read into, and progress is derived data that must not be written back.
    items: matched.slice(start, start + pageSize).map((entry) => ({ ...entry, progress: progressOf(entry) ?? null })),
    total: matched.length,
    totalAcrossFolders: byFavorite.length,
    tagCounts,
    page,
    pageCount,
    pageSize,
  }
}
