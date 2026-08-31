import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, queryCatalog } from './catalogQuery.ts'
import type { CatalogEntry } from '../src/types/catalog.ts'
import type { ScorePlayProgress } from '../src/engine/scoreProgress.ts'

function entry(
  id: string,
  title: string,
  uploadedAt: string,
  filename = `${title}.mxl`,
  composer: string | null = null,
  difficulty: CatalogEntry['difficulty'] = null,
): CatalogEntry {
  return { id, title, composer, filename, sizeBytes: 1024, uploadedAt, difficulty }
}

function manyEntries(count: number): CatalogEntry[] {
  return Array.from({ length: count }, (_, index) =>
    // Ascending timestamps, so "score-0" is the oldest and the last one is the
    // most recent.
    entry(`id-${index}`, `score-${index}`, `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`),
  )
}

describe('queryCatalog', () => {
  it('returns the most recently uploaded entries first', () => {
    const result = queryCatalog([
      entry('a', 'Old', '2026-01-01T10:00:00.000Z'),
      entry('b', 'New', '2026-03-01T10:00:00.000Z'),
      entry('c', 'Middle', '2026-02-01T10:00:00.000Z'),
    ])
    expect(result.items.map((item) => item.title)).toEqual(['New', 'Middle', 'Old'])
  })

  it('orders same-timestamp entries deterministically so paging stays stable', () => {
    const sameTime = '2026-01-01T10:00:00.000Z'
    const forward = queryCatalog([entry('b', 'B', sameTime), entry('a', 'A', sameTime)])
    const reversed = queryCatalog([entry('a', 'A', sameTime), entry('b', 'B', sameTime)])
    expect(forward.items.map((item) => item.id)).toEqual(reversed.items.map((item) => item.id))
  })

  it('shows at most 10 entries per page by default', () => {
    const result = queryCatalog(manyEntries(23))
    expect(DEFAULT_PAGE_SIZE).toBe(10)
    expect(result.items).toHaveLength(10)
    expect(result.total).toBe(23)
    expect(result.pageCount).toBe(3)
    expect(result.page).toBe(1)
  })

  it('pages through the results without repeating or skipping an entry', () => {
    const entries = manyEntries(23)
    const seen = [1, 2, 3].flatMap((page) => queryCatalog(entries, { page }).items.map((item) => item.id))
    expect(seen).toHaveLength(23)
    expect(new Set(seen).size).toBe(23)
  })

  it('clamps an out-of-range page onto the last one', () => {
    const result = queryCatalog(manyEntries(23), { page: 99 })
    expect(result.page).toBe(3)
    expect(result.items).toHaveLength(3)
  })

  it('caps the page size a hand-crafted request can ask for', () => {
    const result = queryCatalog(manyEntries(MAX_PAGE_SIZE + 20), { pageSize: 100000 })
    expect(result.items).toHaveLength(MAX_PAGE_SIZE)
  })

  it('reports one page for an empty catalog', () => {
    const result = queryCatalog([])
    expect(result).toMatchObject({ total: 0, page: 1, pageCount: 1 })
    expect(result.items).toEqual([])
  })

  it('searches the composer too', () => {
    const entries = [
      entry('a', 'Album for the Young', '2026-01-01T10:00:00.000Z', 'album.mxl', 'Pyotr Ilyich Tchaikovsky'),
      entry('b', 'Prelude', '2026-01-02T10:00:00.000Z', 'prelude.mxl', 'Frederic Chopin'),
    ]
    expect(queryCatalog(entries, { search: 'tchaikovsky' }).items.map((item) => item.id)).toEqual(['a'])
    expect(queryCatalog(entries, { search: 'chopin prelude' }).items.map((item) => item.id)).toEqual(['b'])
  })

  it('searches title and file name case-insensitively', () => {
    const entries = [
      entry('a', 'Clair de Lune', '2026-01-01T10:00:00.000Z'),
      entry('b', 'Prelude', '2026-01-02T10:00:00.000Z', 'chopin-prelude.musicxml'),
    ]
    expect(queryCatalog(entries, { search: 'CLAIR' }).items.map((item) => item.id)).toEqual(['a'])
    expect(queryCatalog(entries, { search: 'chopin' }).items.map((item) => item.id)).toEqual(['b'])
  })

  it('requires every search term to match', () => {
    const entries = [
      entry('a', 'Clair de Lune', '2026-01-01T10:00:00.000Z'),
      entry('b', 'Clair Matin', '2026-01-02T10:00:00.000Z'),
    ]
    expect(queryCatalog(entries, { search: 'clair lune' }).items.map((item) => item.id)).toEqual(['a'])
    expect(queryCatalog(entries, { search: '  clair   ' }).total).toBe(2)
  })

  it('paginates the filtered set, not the whole catalog', () => {
    const entries = [...manyEntries(15), entry('x', 'Unique Title', '2026-06-01T10:00:00.000Z')]
    const result = queryCatalog(entries, { search: 'unique' })
    expect(result.total).toBe(1)
    expect(result.pageCount).toBe(1)
  })

  it('filters by exact difficulty', () => {
    const entries = [
      entry('a', 'Easy One', '2026-01-01T10:00:00.000Z', 'a.mxl', null, 'easy'),
      entry('b', 'Hard One', '2026-01-02T10:00:00.000Z', 'b.mxl', null, 'hard'),
      entry('c', 'Unset One', '2026-01-03T10:00:00.000Z', 'c.mxl', null, null),
    ]
    expect(queryCatalog(entries, { difficulty: 'easy' }).items.map((item) => item.id)).toEqual(['a'])
    expect(queryCatalog(entries, { difficulty: 'hard' }).items.map((item) => item.id)).toEqual(['b'])
    expect(queryCatalog(entries).total).toBe(3)
  })

  it('combines a difficulty filter with a search term', () => {
    const entries = [
      entry('a', 'Clair de Lune', '2026-01-01T10:00:00.000Z', 'a.mxl', null, 'easy'),
      entry('b', 'Clair Matin', '2026-01-02T10:00:00.000Z', 'b.mxl', null, 'hard'),
    ]
    expect(queryCatalog(entries, { search: 'clair', difficulty: 'easy' }).items.map((item) => item.id)).toEqual(['a'])
  })

  it('keeps only the starred entries under the favorites filter', () => {
    const entries = [
      { ...entry('a', 'Worked On', '2026-01-01T10:00:00.000Z'), favorite: true },
      { ...entry('b', 'Not Starred', '2026-01-02T10:00:00.000Z'), favorite: false },
      // Saved before the field existed: missing means not a favorite.
      entry('c', 'Legacy', '2026-01-03T10:00:00.000Z'),
    ]
    expect(queryCatalog(entries, { favoritesOnly: true }).items.map((item) => item.id)).toEqual(['a'])
    expect(queryCatalog(entries, { favoritesOnly: true }).total).toBe(1)
  })

  it('leaves the listing untouched when the favorites filter is off', () => {
    const entries = [
      { ...entry('a', 'Worked On', '2026-01-01T10:00:00.000Z'), favorite: true },
      entry('b', 'Other', '2026-01-02T10:00:00.000Z'),
    ]
    expect(queryCatalog(entries, { favoritesOnly: false }).total).toBe(2)
    expect(queryCatalog(entries).total).toBe(2)
  })

  it('combines the favorites filter with a search term and a difficulty', () => {
    const entries = [
      { ...entry('a', 'Clair de Lune', '2026-01-01T10:00:00.000Z', 'a.mxl', null, 'easy'), favorite: true },
      { ...entry('b', 'Clair Matin', '2026-01-02T10:00:00.000Z', 'b.mxl', null, 'easy'), favorite: false },
      { ...entry('c', 'Clair Soir', '2026-01-03T10:00:00.000Z', 'c.mxl', null, 'hard'), favorite: true },
    ]
    const result = queryCatalog(entries, { search: 'clair', difficulty: 'easy', favoritesOnly: true })
    expect(result.items.map((item) => item.id)).toEqual(['a'])
  })
})

function progressMap(
  byId: Record<string, Partial<ScorePlayProgress>>,
): Map<string, ScorePlayProgress> {
  return new Map(
    Object.entries(byId).map(([id, value]) => [
      id,
      { percent: 0, completed: false, sessionCount: 1, lastPlayedAt: '2026-01-01T10:00:00.000Z', ...value },
    ]),
  )
}

describe('queryCatalog sorting', () => {
  // Uploaded oldest to newest: a, b, c.
  const entries = [
    entry('a', 'Csardas', '2026-01-01T10:00:00.000Z'),
    entry('b', 'apple', '2026-01-02T10:00:00.000Z'),
    entry('c', 'Ballade', '2026-01-03T10:00:00.000Z'),
  ]

  it('sorts by title case-insensitively rather than by ASCII order', () => {
    const result = queryCatalog(entries, { sort: 'title' })
    expect(result.items.map((item) => item.title)).toEqual(['apple', 'Ballade', 'Csardas'])
  })

  it('sorts by last played, with never-played entries last', () => {
    const progress = progressMap({
      a: { lastPlayedAt: '2026-02-01T10:00:00.000Z' },
      c: { lastPlayedAt: '2026-03-01T10:00:00.000Z' },
    })
    const result = queryCatalog(entries, { sort: 'lastPlayed', progress })
    expect(result.items.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('sorts by progress, and puts a never-played entry below one still at 0%', () => {
    const progress = progressMap({ a: { percent: 40 }, b: { percent: 0 } })
    const result = queryCatalog(entries, { sort: 'progress', progress })
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by how many sessions a piece has', () => {
    const progress = progressMap({ a: { sessionCount: 2 }, c: { sessionCount: 9 } })
    const result = queryCatalog(entries, { sort: 'played', progress })
    expect(result.items.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('breaks every tie by upload date, so paging cannot drift between requests', () => {
    const progress = progressMap({ a: { percent: 50 }, b: { percent: 50 }, c: { percent: 50 } })
    const result = queryCatalog(entries, { sort: 'progress', progress })
    expect(result.items.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts the whole catalog before paginating, not just the page it returns', () => {
    const many = manyEntries(25)
    // The oldest upload is the only played one, so it must reach page 1.
    const progress = progressMap({ 'id-0': { percent: 90 } })
    const result = queryCatalog(many, { sort: 'progress', progress, page: 1 })
    expect(result.items[0].id).toBe('id-0')
  })

  it('attaches each entry its progress without touching the stored objects', () => {
    const stored = [entry('a', 'Csardas', '2026-01-01T10:00:00.000Z')]
    const result = queryCatalog(stored, { progress: progressMap({ a: { percent: 30 } }) })
    expect(result.items[0].progress).toMatchObject({ percent: 30 })
    expect(stored[0]).not.toHaveProperty('progress')
  })

  it('reports null progress for a piece never practised', () => {
    const result = queryCatalog([entry('a', 'Csardas', '2026-01-01T10:00:00.000Z')])
    expect(result.items[0].progress).toBeNull()
  })
})

describe('queryCatalog, title order', () => {
  it('orders numbered pieces numerically, so No. 10 comes after No. 9', () => {
    const entries = [
      entry('a', 'Op. 100 No. 10. Tendre Fleur', '2026-01-01T10:00:00.000Z'),
      entry('b', 'Op. 100 No. 2. Arabesque', '2026-01-02T10:00:00.000Z'),
      entry('c', 'Op. 100 No. 9. La Chasse', '2026-01-03T10:00:00.000Z'),
    ]
    expect(queryCatalog(entries, { sort: 'title' }).items.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('queryCatalog, virtual folders', () => {
  function tagged(id: string, tags: string[], favorite = false): CatalogEntry {
    return { ...entry(id, `score-${id}`, `2026-02-01T10:00:00.000Z`), tags, favorite }
  }

  it('keeps a folder and its descendants', () => {
    const entries = [tagged('a', ['study/bartok']), tagged('b', ['study/czerny']), tagged('c', ['personal'])]
    expect(queryCatalog(entries, { tag: 'study' }).items.map((item) => item.id).sort()).toEqual(['a', 'b'])
    expect(queryCatalog(entries, { tag: 'study/bartok' }).items.map((item) => item.id)).toEqual(['a'])
  })

  it('is a filter, not a mode: no tag means every folder', () => {
    const entries = [tagged('a', ['beginner-1']), tagged('b', ['personal'])]
    expect(queryCatalog(entries, {}).total).toBe(2)
    expect(queryCatalog(entries, { tag: '' }).total).toBe(2)
  })

  it('counts folders under the other filters but not under the folder filter itself', () => {
    // The faceted-search rule: selecting one folder must not zero its siblings,
    // otherwise the tree stops answering "where are my favorites?".
    const entries = [
      tagged('a', ['beginner-1', 'study/bartok'], true),
      tagged('b', ['beginner-2'], true),
      tagged('c', ['beginner-2'], false),
    ]
    const result = queryCatalog(entries, { favoritesOnly: true, tag: 'beginner-1' })
    expect(result.items.map((item) => item.id)).toEqual(['a'])
    expect(result.total).toBe(1)
    // Both favorites, whichever folder they are in.
    expect(result.totalAcrossFolders).toBe(2)
    expect(result.tagCounts).toEqual({ 'beginner-1': 1, 'beginner-2': 1, study: 1, 'study/bartok': 1 })
  })

  it('ANDs the folder with the search and the difficulty', () => {
    const entries = [
      { ...tagged('a', ['study/czerny']), title: 'Etude in C', difficulty: 'easy' as const },
      { ...tagged('b', ['study/czerny']), title: 'Etude in D', difficulty: 'hard' as const },
      { ...tagged('c', ['personal']), title: 'Etude in C', difficulty: 'easy' as const },
    ]
    expect(queryCatalog(entries, { tag: 'study', search: 'etude c', difficulty: 'easy' }).items.map((i) => i.id)).toEqual(
      ['a'],
    )
  })

  it('leaves an untagged entry out of every folder but not out of the catalog', () => {
    const entries = [entry('a', 'Untagged', '2026-02-01T10:00:00.000Z'), tagged('b', ['personal'])]
    expect(queryCatalog(entries, {}).total).toBe(2)
    expect(queryCatalog(entries, { tag: 'personal' }).items.map((item) => item.id)).toEqual(['b'])
    expect(queryCatalog(entries, {}).tagCounts).toEqual({ personal: 1 })
  })
})
