import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CatalogEntry } from '../src/types/catalog.ts'

export const ALLOWED_EXTENSIONS = ['.musicxml', '.xml', '.mxl']
export const MAX_SCORE_BYTES = 20 * 1024 * 1024

// Ids are generated with randomUUID, so anything else came from a crafted URL
// and must never be turned into a file path.
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Resolved from the working directory (the repo root, both for `npm run dev`
 * and `npm start`) unless overridden. Deliberately not derived from
 * import.meta.url: in dev this module is bundled into a temporary Vite config
 * file at an unrelated path, which would silently move the data directory.
 */
export function resolveDataDir(): string {
  const override = process.env.PIANO_TRAINER_DATA_DIR
  return override ? path.resolve(override) : path.resolve(process.cwd(), 'data')
}

function catalogPath(dataDir: string): string {
  return path.join(dataDir, 'catalog.json')
}

function scoresDir(dataDir: string): string {
  return path.join(dataDir, 'scores')
}

export function extensionOf(filename: string): string | null {
  const lower = filename.toLowerCase()
  return ALLOWED_EXTENSIONS.find((extension) => lower.endsWith(extension)) ?? null
}

function titleFromFilename(filename: string): string {
  const extension = extensionOf(filename)
  const base = extension ? filename.slice(0, -extension.length) : filename
  return base.trim() || filename
}

export function readCatalog(dataDir: string): CatalogEntry[] {
  const file = catalogPath(dataDir)
  if (!existsSync(file)) {
    return []
  }
  // A corrupt catalog throws rather than being silently treated as empty --
  // an empty catalog would be overwritten by the next upload, losing every
  // entry while the score files themselves are still on disk.
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON array`)
  }
  return parsed as CatalogEntry[]
}

function writeCatalog(dataDir: string, entries: CatalogEntry[]): void {
  mkdirSync(dataDir, { recursive: true })
  // Write-then-rename: a crash mid-write leaves the previous catalog intact
  // instead of a truncated file that would throw on every later read.
  const temporary = `${catalogPath(dataDir)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  renameSync(temporary, catalogPath(dataDir))
}

export function findEntry(dataDir: string, id: string): CatalogEntry | null {
  if (!ID_PATTERN.test(id)) {
    return null
  }
  return readCatalog(dataDir).find((entry) => entry.id === id) ?? null
}

/** Absolute path of the stored file, or null if it went missing on disk. */
export function scoreFilePath(dataDir: string, entry: CatalogEntry): string | null {
  const extension = extensionOf(entry.filename)
  if (!extension || !ID_PATTERN.test(entry.id)) {
    return null
  }
  const file = path.join(scoresDir(dataDir), `${entry.id}${extension}`)
  return existsSync(file) ? file : null
}

export function addScore(dataDir: string, filename: string, data: Uint8Array): CatalogEntry {
  const extension = extensionOf(filename)
  if (!extension) {
    throw new Error(`Unsupported file type: ${filename}`)
  }
  const id = randomUUID()
  mkdirSync(scoresDir(dataDir), { recursive: true })
  // The stored name is derived from our own id, never from the uploaded name,
  // so a filename like "../../etc/passwd.xml" can't escape the scores folder.
  writeFileSync(path.join(scoresDir(dataDir), `${id}${extension}`), data)

  const safeFilename = path.basename(filename)
  const entry: CatalogEntry = {
    id,
    title: titleFromFilename(safeFilename),
    filename: safeFilename,
    sizeBytes: data.byteLength,
    uploadedAt: new Date().toISOString(),
  }
  writeCatalog(dataDir, [entry, ...readCatalog(dataDir)])
  return entry
}
