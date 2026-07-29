import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { queryCatalog } from './catalogQuery.ts'
import {
  addScore,
  ALLOWED_EXTENSIONS,
  extensionOf,
  findEntry,
  MAX_SCORE_BYTES,
  readCatalog,
  resolveDataDir,
  scoreFilePath,
} from './catalogStore.ts'

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

function handleList(res: ServerResponse, dataDir: string, url: URL): void {
  sendJson(
    res,
    200,
    queryCatalog(readCatalog(dataDir), {
      search: url.searchParams.get('q') ?? '',
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

export function createCatalogApi(dataDir: string = resolveDataDir()): CatalogApiHandler {
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
      if (url.pathname === '/api/scores' && req.method === 'GET') {
        handleList(res, dataDir, url)
      } else if (url.pathname === '/api/scores' && req.method === 'POST') {
        await handleUpload(req, res, dataDir, url)
      } else if (downloadMatch && req.method === 'GET') {
        handleDownload(res, dataDir, decodeURIComponent(downloadMatch[1]))
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
