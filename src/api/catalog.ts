import type { CatalogEntry, CatalogPage } from '../types/catalog'

export interface CatalogQueryParams {
  search: string
  page: number
  pageSize?: number
  signal?: AbortSignal
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

export async function fetchCatalogPage({ search, page, pageSize, signal }: CatalogQueryParams): Promise<CatalogPage> {
  const params = new URLSearchParams({ q: search, page: String(page) })
  if (pageSize !== undefined) {
    params.set('limit', String(pageSize))
  }
  const response = await fetch(`/api/scores?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return (await response.json()) as CatalogPage
}

export async function uploadScore(file: File): Promise<CatalogEntry> {
  const response = await fetch(`/api/scores?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return (await response.json()) as CatalogEntry
}

/**
 * Rebuilds a File from a stored score. The original file name matters: OSMD
 * decides how to read the content (compressed .mxl vs plain XML) from it, so a
 * catalog score has to reach PianoScore exactly as a freshly picked file would.
 */
export async function downloadScoreFile(entry: CatalogEntry): Promise<File> {
  const response = await fetch(`/api/scores/${encodeURIComponent(entry.id)}/file`)
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return new File([await response.blob()], entry.filename)
}
