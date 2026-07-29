// Production server: serves the built front-end from dist/ and mounts the very
// same catalog API the Vite dev server mounts in development (see
// vite.config.ts), so there is only one implementation of the endpoints.
//
//   npm run build && npm start
//
// Environment: PORT (default 4173), PIANO_TRAINER_DATA_DIR (default ./data).

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createCatalogApi } from './catalogApi.ts'
import { resolveDataDir } from './catalogStore.ts'

const PORT = Number(process.env.PORT ?? 4173)
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

function sendFile(res: ServerResponse, file: string, immutable: boolean): void {
  res.writeHead(200, {
    'content-type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    // Vite fingerprints everything under /assets, so those can be cached
    // forever; index.html must not be, or a deploy never reaches the browser.
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
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
    sendFile(res, requested, pathname.startsWith('/assets/'))
    return
  }

  // Single-page app fallback.
  const indexFile = path.join(DIST_DIR, 'index.html')
  if (!existsSync(indexFile)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dist/index.html is missing -- run `npm run build` first.')
    return
  }
  sendFile(res, indexFile, false)
}

const catalogApi = createCatalogApi()

createServer((req, res) => {
  catalogApi(req, res, () => serveStatic(req, res))
}).listen(PORT, () => {
  console.log(`Piano Trainer listening on http://localhost:${PORT}`)
  console.log(`Catalog data directory: ${resolveDataDir()}`)
})
