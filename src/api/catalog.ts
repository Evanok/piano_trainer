import { AuthRequiredError, authHeaders, notifyAuthRequired } from './auth'
import type { CatalogEntry, CatalogPage, CatalogSort, ScoreDifficulty } from '../types/catalog'

export interface CatalogQueryParams {
  search: string
  difficulty?: ScoreDifficulty
  favoritesOnly?: boolean
  /** Selected virtual folder; omitted or empty means every folder. */
  tag?: string
  /** Omitted means the server's default order (most recently uploaded first). */
  sort?: CatalogSort
  page: number
  pageSize?: number
  signal?: AbortSignal
}

/** Every non-ok response goes through here, so a 401 always surfaces as the
 *  typed error the app reacts to by asking for the password again. */
async function failed(response: Response): Promise<never> {
  if (response.status === 401) {
    notifyAuthRequired()
    throw new AuthRequiredError()
  }
  throw new Error(await readError(response))
}

// The server answers errors as { error: string }; fall back to the status line
// when the response isn't JSON at all (a proxy error page, for instance).
async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      return (body as { error: string }).error
    }
  } catch {
    // Ignore, use the status text below.
  }
  return `${response.status} ${response.statusText}`
}

export async function fetchCatalogPage({
  search,
  difficulty,
  favoritesOnly,
  tag,
  sort,
  page,
  pageSize,
  signal,
}: CatalogQueryParams): Promise<CatalogPage> {
  const params = new URLSearchParams({ q: search, page: String(page) })
  if (difficulty !== undefined) {
    params.set('difficulty', difficulty)
  }
  if (favoritesOnly) {
    params.set('favorite', '1')
  }
  if (tag) {
    params.set('tag', tag)
  }
  if (sort !== undefined) {
    params.set('sort', sort)
  }
  if (pageSize !== undefined) {
    params.set('limit', String(pageSize))
  }
  const response = await fetch(`/api/scores?${params.toString()}`, { signal, headers: authHeaders() })
  if (!response.ok) {
    await failed(response)
  }
  return (await response.json()) as CatalogPage
}

export interface CatalogEntryUpdate {
  title?: string
  composer?: string | null
  difficulty?: ScoreDifficulty | null
  favorite?: boolean
  /** The whole list; the server normalizes it before storing. */
  tags?: string[]
  /** Set by the library importer only, to recognise a score it already added. */
  sourceId?: string
}

export async function updateScoreEntry(id: string, update: CatalogEntryUpdate): Promise<CatalogEntry> {
  const response = await fetch(`/api/scores/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(update),
  })
  if (!response.ok) {
    await failed(response)
  }
  return (await response.json()) as CatalogEntry
}

export async function deleteScoreEntry(id: string): Promise<void> {
  const response = await fetch(`/api/scores/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!response.ok) {
    await failed(response)
  }
}

export async function uploadScore(file: File): Promise<CatalogEntry> {
  const response = await fetch(`/api/scores?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...authHeaders() },
    body: file,
  })
  if (!response.ok) {
    await failed(response)
  }
  return (await response.json()) as CatalogEntry
}

/**
 * Rebuilds a File from a stored score. The original file name matters: OSMD
 * decides how to read the content (compressed .mxl vs plain XML) from it, so a
 * catalog score has to reach PianoScore exactly as a freshly picked file would.
 */
export async function downloadScoreFile(entry: CatalogEntry): Promise<File> {
  const response = await fetch(`/api/scores/${encodeURIComponent(entry.id)}/file`, { headers: authHeaders() })
  if (!response.ok) {
    await failed(response)
  }
  return new File([await response.blob()], entry.filename)
}
