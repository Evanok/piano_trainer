import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { queryCatalog } from './catalogQuery.ts'
import { CATALOG_SORTS, DEFAULT_CATALOG_SORT, type CatalogSort, type ScoreDifficulty } from '../src/types/catalog.ts'
import {
  addScore,
  ALLOWED_EXTENSIONS,
  deleteEntry,
  extensionOf,
  findEntry,
  MAX_SCORE_BYTES,
  readCatalog,
  resolveDataDir,
  scoreFilePath,
  updateEntry,
} from './catalogStore.ts'
import { readScoreProgress, readSessions, syncSessions } from './statsStore.ts'
import {
  AUTH_HEADER,
  configuredGuestPassword,
  configuredPassword,
  createLoginThrottle,
  guestToken,
  resolveRole,
  tokenForPassword,
} from './auth.ts'
import type { ApiRole } from '../src/types/auth.ts'

/** Connect-style middleware, so the same handler runs in dev (mounted on the
 *  Vite dev server) and in production (server/index.ts). */
export type CatalogApiHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The catalog changes on every upload and is tiny; never let a proxy or
    // the browser serve a stale listing.
    'cache-control': 'no-store',
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.byteLength
    if (total > maxBytes) {
      throw new HttpError(413, `Score file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined
}

const VALID_DIFFICULTIES: ScoreDifficulty[] = ['easy', 'medium', 'hard']

// A malformed ?difficulty= (or none at all) just means "no filter" -- same
// leniency as parsePositiveInt above, no need to 400 a GET listing over it.
function parseDifficulty(raw: string | null): ScoreDifficulty | undefined {
  return raw !== null && (VALID_DIFFICULTIES as string[]).includes(raw) ? (raw as ScoreDifficulty) : undefined
}

// Same leniency again: an unknown ?sort= falls back to the default order rather
// than failing the listing.
function parseSort(raw: string | null): CatalogSort {
  return raw !== null && (CATALOG_SORTS as string[]).includes(raw) ? (raw as CatalogSort) : DEFAULT_CATALOG_SORT
}

function handleList(res: ServerResponse, dataDir: string, url: URL): void {
  sendJson(
    res,
    200,
    queryCatalog(readCatalog(dataDir), {
      // Joined in from the shared practice history, which is what makes the
      // progress bar and the play-based sorts agree across devices (and what
      // lets them work at all with pagination, since sorting must happen over
      // the whole catalog, not over one page).
      progress: readScoreProgress(dataDir),
      sort: parseSort(url.searchParams.get('sort')),
      search: url.searchParams.get('q') ?? '',
      difficulty: parseDifficulty(url.searchParams.get('difficulty')),
      // Only ?favorite=1 turns the filter on; anything else (absent, 0, junk)
      // means "no filter", same leniency as the other listing parameters.
      favoritesOnly: url.searchParams.get('favorite') === '1',
      page: parsePositiveInt(url.searchParams.get('page')),
      pageSize: parsePositiveInt(url.searchParams.get('limit')),
    }),
  )
}

async function handleUpload(req: IncomingMessage, res: ServerResponse, dataDir: string, url: URL): Promise<void> {
  // The file is posted as a raw body with the name in the query string rather
  // than as multipart/form-data -- one less thing to parse, and no dependency.
  const filename = url.searchParams.get('filename')
  if (!filename) {
    throw new HttpError(400, 'Missing ?filename= query parameter.')
  }
  if (!extensionOf(filename)) {
    throw new HttpError(415, `Unsupported file type. Expected one of ${ALLOWED_EXTENSIONS.join(', ')}.`)
  }
  const data = await readBody(req, MAX_SCORE_BYTES)
  if (data.byteLength === 0) {
    throw new HttpError(400, 'Empty file.')
  }
  sendJson(res, 201, await addScore(dataDir, filename, data))
}

// A metadata edit is a couple of short strings, nowhere near a score file --
// capped separately (and much lower) than MAX_SCORE_BYTES.
const MAX_METADATA_BYTES = 10 * 1024

async function handleUpdate(req: IncomingMessage, res: ServerResponse, dataDir: string, id: string): Promise<void> {
  const body = await readBody(req, MAX_METADATA_BYTES)
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new HttpError(400, 'Request body must be a JSON object.')
  }
  const {
    title: rawTitle,
    composer: rawComposer,
    difficulty: rawDifficulty,
    favorite: rawFavorite,
  } = payload as { title?: unknown; composer?: unknown; difficulty?: unknown; favorite?: unknown }

  const update: {
    title?: string
    composer?: string | null
    difficulty?: ScoreDifficulty | null
    favorite?: boolean
  } = {}
  if (rawTitle !== undefined) {
    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
      throw new HttpError(400, 'Title cannot be empty.')
    }
    update.title = rawTitle.trim()
  }
  if (rawComposer !== undefined) {
    if (rawComposer !== null && typeof rawComposer !== 'string') {
      throw new HttpError(400, 'Composer must be a string or null.')
    }
    update.composer = typeof rawComposer === 'string' ? rawComposer.trim() || null : rawComposer
  }
  if (rawDifficulty !== undefined) {
    if (rawDifficulty !== null && !VALID_DIFFICULTIES.includes(rawDifficulty as ScoreDifficulty)) {
      throw new HttpError(400, `Difficulty must be one of ${VALID_DIFFICULTIES.join(', ')}, or null.`)
    }
    update.difficulty = rawDifficulty as ScoreDifficulty | null
  }
  if (rawFavorite !== undefined) {
    if (typeof rawFavorite !== 'boolean') {
      throw new HttpError(400, 'Favorite must be a boolean.')
    }
    update.favorite = rawFavorite
  }
  if (
    update.title === undefined &&
    update.composer === undefined &&
    update.difficulty === undefined &&
    update.favorite === undefined
  ) {
    throw new HttpError(400, 'Nothing to update: provide title, composer, difficulty and/or favorite.')
  }

  const entry = updateEntry(dataDir, id, update)
  if (!entry) {
    throw new HttpError(404, 'Score not found in the catalog.')
  }
  sendJson(res, 200, entry)
}

function handleDelete(res: ServerResponse, dataDir: string, id: string): void {
  if (!deleteEntry(dataDir, id)) {
    throw new HttpError(404, 'Score not found in the catalog.')
  }
  res.writeHead(204).end()
}

// A whole practice history, not one score file: a few hundred bytes per
// session, so this is generous for the per-device cap (MAX_STORED_SESSIONS)
// while still being nowhere near MAX_SCORE_BYTES.
const MAX_STATS_BYTES = 8 * 1024 * 1024

async function handleStatsSync(req: IncomingMessage, res: ServerResponse, dataDir: string): Promise<void> {
  const body = await readBody(req, MAX_STATS_BYTES)
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { sessions?: unknown }).sessions)) {
    throw new HttpError(400, 'Request body must be a JSON object with a sessions array.')
  }
  // Answers with the merged history, so one round-trip both pushes what this
  // device recorded and pulls back everything the others did.
  sendJson(res, 200, { sessions: syncSessions(dataDir, (payload as { sessions: unknown[] }).sessions) })
}

// A password and nothing else.
const MAX_LOGIN_BYTES = 1024

async function handleLogin(req: IncomingMessage, res: ServerResponse, throttle: ReturnType<typeof createLoginThrottle>): Promise<void> {
  const password = configuredPassword()
  if (!password) {
    throw new HttpError(409, 'This server has no password configured.')
  }
  if (throttle.isBlocked(Date.now())) {
    throw new HttpError(429, 'Too many failed attempts. Wait a minute and try again.')
  }
  const body = await readBody(req, MAX_LOGIN_BYTES)
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
  const submitted = (payload as { password?: unknown } | null)?.password
  const guestPassword = configuredGuestPassword()
  // The guest password is accepted here too, so the read-only access also
  // works by typing it in rather than only through the share link.
  const matched: { password: string; role: ApiRole } | null =
    typeof submitted !== 'string'
      ? null
      : submitted === password
        ? { password, role: 'owner' }
        : guestPassword !== null && submitted === guestPassword
          ? { password: guestPassword, role: 'guest' }
          : null
  if (matched === null) {
    throttle.registerFailure(Date.now())
    throw new HttpError(401, 'Wrong password.')
  }
  throttle.reset()
  sendJson(res, 200, { token: tokenForPassword(matched.password, matched.role), role: matched.role })
}

function handleDownload(res: ServerResponse, dataDir: string, id: string): void {
  const entry = findEntry(dataDir, id)
  if (!entry) {
    throw new HttpError(404, 'Score not found in the catalog.')
  }
  const file = scoreFilePath(dataDir, entry)
  if (!file) {
    throw new HttpError(410, 'The catalog lists this score but its file is missing on disk.')
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${encodeURIComponent(entry.filename)}"`,
    'content-length': entry.sizeBytes,
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(res)
}

/**
 * Everything a guest link may do: browse the catalog, open a score, read the
 * practice history. Deliberately an allowlist rather than a list of forbidden
 * writes, so a new endpoint is closed to guests until someone decides otherwise.
 */
export function isAllowedForGuest(method: string | undefined, pathname: string): boolean {
  if (method !== 'GET') {
    return false
  }
  return (
    pathname === '/api/scores' ||
    pathname === '/api/stats' ||
    /^\/api\/scores\/[^/]+\/file$/.test(pathname)
  )
}

export function createCatalogApi(dataDir: string = resolveDataDir()): CatalogApiHandler {
  const loginThrottle = createLoginThrottle()
  return (req, res, next) => {
    // The origin is irrelevant, URL just needs an absolute base to parse
    // against; only the path and the query string are ever used.
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) {
      next()
      return
    }

    const run = async (): Promise<void> => {
      const downloadMatch = /^\/api\/scores\/([^/]+)\/file$/.exec(url.pathname)
      const entryMatch = /^\/api\/scores\/([^/]+)$/.exec(url.pathname)
      const password = configuredPassword()
      const token = req.headers[AUTH_HEADER]
      const role = resolveRole(typeof token === 'string' ? token : undefined)

      // The only two open endpoints: what the front-end needs to know whether
      // to show a login screen, and the login itself.
      if (url.pathname === '/api/auth' && req.method === 'GET') {
        sendJson(res, 200, {
          required: password !== null,
          authenticated: role !== null,
          role,
          // The guest token is the whole secret of the share link, so it only
          // ever goes back to the owner (who is the one who shares it).
          guestToken: role === 'owner' ? guestToken() : null,
        })
        return
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        await handleLogin(req, res, loginThrottle)
        return
      }
      // Everything else, reads included -- see server/auth.ts for why the gate
      // lives here and not in the UI.
      if (role === null) {
        throw new HttpError(401, 'Authentication required.')
      }
      // 403, deliberately not 401: the front-end treats a 401 as "this token is
      // no longer any good", drops it and shows the login screen, which would
      // throw a guest out on their first blocked request instead of just
      // refusing that one call.
      if (role === 'guest' && !isAllowedForGuest(req.method, url.pathname)) {
        throw new HttpError(403, 'This link is read-only.')
      }

      if (url.pathname === '/api/stats' && req.method === 'GET') {
        sendJson(res, 200, { sessions: readSessions(dataDir) })
      } else if (url.pathname === '/api/stats/sync' && req.method === 'POST') {
        await handleStatsSync(req, res, dataDir)
      } else if (url.pathname === '/api/scores' && req.method === 'GET') {
        handleList(res, dataDir, url)
      } else if (url.pathname === '/api/scores' && req.method === 'POST') {
        await handleUpload(req, res, dataDir, url)
      } else if (downloadMatch && req.method === 'GET') {
        handleDownload(res, dataDir, decodeURIComponent(downloadMatch[1]))
      } else if (entryMatch && req.method === 'PATCH') {
        await handleUpdate(req, res, dataDir, decodeURIComponent(entryMatch[1]))
      } else if (entryMatch && req.method === 'DELETE') {
        handleDelete(res, dataDir, decodeURIComponent(entryMatch[1]))
      } else {
        throw new HttpError(404, `No such endpoint: ${req.method} ${url.pathname}`)
      }
    }

    run().catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (status >= 500) {
        console.error(`[catalog] ${req.method} ${url.pathname} failed:`, error)
      }
      if (!res.headersSent) {
        sendJson(res, status, { error: message })
      } else {
        res.end()
      }
    })
  }
}
