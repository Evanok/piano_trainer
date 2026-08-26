// Production server: serves the built front-end from dist/ and mounts the very
// same catalog API the Vite dev server mounts in development (see
// vite.config.ts), so there is only one implementation of the endpoints.
//
//   npm run build && npm start
//
// Environment: PORT (default 5173), PIANO_TRAINER_DATA_DIR (default ./data),
// PIANO_TRAINER_PASSWORD (no password gate when unset -- see server/auth.ts).

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { createCatalogApi } from './catalogApi.ts'
import { migrateCatalog, resolveDataDir } from './catalogStore.ts'
import { configuredPassword } from './auth.ts'

// Piano Trainer is exposed directly on this port; there is no Nginx proxy.
const PORT = Number(process.env.PORT ?? 5173)
const DIST_DIR = path.resolve(process.cwd(), 'dist')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Text compresses; PNG, WOFF2 and the backing-track audio are already
// compressed, so gzipping them would burn CPU to make them very slightly
// bigger. The app bundle is by far the biggest thing here: ~1.5 MB of
// JavaScript (React plus OpenSheetMusicDisplay) that every first-time visitor
// downloads before seeing anything.
const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.svg'])

/**
 * Compressed bodies for the fingerprinted assets, built once and kept.
 *
 * Vite puts a content hash in every /assets file name, so a path identifies its
 * bytes for good and this can never go stale. It matters under load: without
 * it, every single visitor costs ~40 ms of CPU compressing the same 1.5 MB
 * bundle again, on a server that runs one thread for everything. Bounded by the
 * number of built asset files, and the process restarts on each deploy.
 */
const compressedAssets = new Map<string, Buffer>()

function acceptsGzip(req: IncomingMessage): boolean {
  const header = req.headers['accept-encoding']
  return typeof header === 'string' && /\bgzip\b/.test(header)
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, immutable: boolean): void {
  const headers: Record<string, string | number> = {
    'content-type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    // Vite fingerprints everything under /assets, so those can be cached
    // forever; index.html must not be, or a deploy never reaches the browser.
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  }

  if (!COMPRESSIBLE_EXTENSIONS.has(path.extname(file).toLowerCase()) || !acceptsGzip(req)) {
    res.writeHead(200, { ...headers, 'content-length': statSync(file).size })
    createReadStream(file).pipe(res)
    return
  }

  let body = immutable ? compressedAssets.get(file) : undefined
  if (!body) {
    body = gzipSync(readFileSync(file))
    if (immutable) {
      compressedAssets.set(file, body)
    }
  }
  res.writeHead(200, {
    ...headers,
    'content-encoding': 'gzip',
    'content-length': body.byteLength,
    // One URL, two possible bodies, so any cache in between has to key on the
    // request's encoding rather than serve gzip to a client that asked for none.
    vary: 'Accept-Encoding',
  })
  res.end(body)
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Method not allowed')
    return
  }
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const requested = path.resolve(DIST_DIR, `.${decodeURIComponent(pathname)}`)
  // path.resolve collapses any "..", so this single check is enough to keep
  // every served path inside dist/.
  const insideDist = requested === DIST_DIR || requested.startsWith(`${DIST_DIR}${path.sep}`)

  if (insideDist && existsSync(requested) && statSync(requested).isFile()) {
    sendFile(req, res, requested, pathname.startsWith('/assets/'))
    return
  }

  // Single-page app fallback.
  const indexFile = path.join(DIST_DIR, 'index.html')
  if (!existsSync(indexFile)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dist/index.html is missing -- run `npm run build` first.')
    return
  }
  sendFile(req, res, indexFile, false)
}

const dataDir = resolveDataDir()
// A broken catalog must not keep the app from booting: the front-end is still
// served, only the API will report the error.
await migrateCatalog(dataDir).catch((error: unknown) => {
  console.error('[catalog] metadata migration failed:', error)
})
const catalogApi = createCatalogApi(dataDir)

createServer((req, res) => {
  catalogApi(req, res, () => serveStatic(req, res))
}).listen(PORT, () => {
  console.log(`Piano Trainer listening on http://localhost:${PORT}`)
  console.log(`Catalog data directory: ${dataDir}`)
  // Loud, because an open server on a public port means anyone can read the
  // practice history and delete catalog entries. Unset stays permitted so an
  // existing deployment upgrades without locking its owner out.
  console.log(
    configuredPassword()
      ? 'Password gate: enabled (PIANO_TRAINER_PASSWORD is set)'
      : 'WARNING: no PIANO_TRAINER_PASSWORD set -- the API is open to anyone who can reach this port.',
  )
})
