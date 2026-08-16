import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { extractScoreMetadata } from './scoreMetadata.ts'
import type { CatalogEntry, ScoreDifficulty } from '../src/types/catalog.ts'

export const ALLOWED_EXTENSIONS = ['.musicxml', '.xml', '.mxl']
export const MAX_SCORE_BYTES = 20 * 1024 * 1024

/**
 * Bump whenever extractScoreMetadata changes how it derives title/composer:
 * migrateCatalog re-reads every entry stamped with an older version at the next
 * start, so an improvement reaches scores that are already in the catalog.
 *   1: no extraction at all, title was the raw file name
 *   2: MusicXML work-title / composer, first line only
 */
export const METADATA_VERSION = 2

/** A catalog entry as stored on disk: the wire shape plus our own bookkeeping
 *  (the front-end ignores metadataVersion). */
export interface StoredEntry extends CatalogEntry {
  metadataVersion?: number
}

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

// Lowercased inside a title, capitalized only when they open it -- the point is
// "Album for the Young", not "Album For The Young".
const MINOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'de',
  'des',
  'du',
  'for',
  'in',
  'la',
  'le',
  'les',
  'of',
  'on',
  'or',
  'the',
  'to',
])

/**
 * Fallback title for a score whose MusicXML carries no title of its own:
 * turns a slug like "tchaikovsky-album-for-the-young" into
 * "Tchaikovsky Album for the Young".
 * A name that already contains spaces is assumed to be human-written and is
 * left alone (so "Clair de Lune" doesn't become "Clair De Lune").
 */
export function titleFromFilename(filename: string): string {
  const extension = extensionOf(filename)
  const base = (extension ? filename.slice(0, -extension.length) : filename).trim()
  const words = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words) {
    return filename
  }
  if (/\s/.test(base)) {
    return words
  }
  return words
    .split(' ')
    .map((word, index) => {
      if (index > 0 && MINOR_WORDS.has(word)) {
        return word
      }
      // Only touch all-lowercase words, so an acronym or a deliberate casing
      // ("BWV", "iPhone") survives untouched.
      return word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word
    })
    .join(' ')
}

export function readCatalog(dataDir: string): StoredEntry[] {
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
  return parsed as StoredEntry[]
}

function writeCatalog(dataDir: string, entries: StoredEntry[]): void {
  mkdirSync(dataDir, { recursive: true })
  // Write-then-rename: a crash mid-write leaves the previous catalog intact
  // instead of a truncated file that would throw on every later read.
  const temporary = `${catalogPath(dataDir)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  renameSync(temporary, catalogPath(dataDir))
}

export function findEntry(dataDir: string, id: string): StoredEntry | null {
  if (!ID_PATTERN.test(id)) {
    return null
  }
  return readCatalog(dataDir).find((entry) => entry.id === id) ?? null
}

export interface CatalogEntryUpdate {
  title?: string
  composer?: string | null
  difficulty?: ScoreDifficulty | null
}

/**
 * Applies a user edit (title/composer/difficulty only -- everything else
 * about an entry is derived from the uploaded file, not editable). A field
 * left out of `update` is untouched; `composer: null`/`difficulty: null`
 * explicitly clears it. Returns null when the id doesn't resolve to an
 * entry, same as findEntry.
 */
export function updateEntry(dataDir: string, id: string, update: CatalogEntryUpdate): StoredEntry | null {
  if (!ID_PATTERN.test(id)) {
    return null
  }
  const entries = readCatalog(dataDir)
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) {
    return null
  }
  if (update.title !== undefined) {
    entry.title = update.title
  }
  if (update.composer !== undefined) {
    entry.composer = update.composer
  }
  if (update.difficulty !== undefined) {
    entry.difficulty = update.difficulty
  }
  writeCatalog(dataDir, entries)
  return entry
}

/**
 * Removes an entry from the catalog and deletes its file on disk. Returns
 * false (no-op) when the id doesn't resolve to an entry, same convention as
 * updateEntry/findEntry -- a missing score is not an error, just nothing to do.
 */
export function deleteEntry(dataDir: string, id: string): boolean {
  if (!ID_PATTERN.test(id)) {
    return false
  }
  const entries = readCatalog(dataDir)
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) {
    return false
  }
  const file = scoreFilePath(dataDir, entry)
  // The catalog entry is removed even if the file is already gone on disk --
  // an orphaned entry pointing at nothing is worse than a slightly-early write.
  if (file) {
    unlinkSync(file)
  }
  writeCatalog(
    dataDir,
    entries.filter((candidate) => candidate.id !== id),
  )
  return true
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

export async function addScore(dataDir: string, filename: string, data: Uint8Array): Promise<StoredEntry> {
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
  const metadata = await extractScoreMetadata(safeFilename, data)
  const entry: StoredEntry = {
    id,
    // The score's own title beats the file name, which is usually a slug from
    // wherever it was downloaded ("persona-5-piano-the-days-when...").
    title: metadata.title ?? titleFromFilename(safeFilename),
    composer: metadata.composer,
    // Nothing in a MusicXML file states how hard it is to play -- always
    // starts unset, the player assigns it manually via updateEntry.
    difficulty: null,
    filename: safeFilename,
    sizeBytes: data.byteLength,
    uploadedAt: new Date().toISOString(),
    metadataVersion: METADATA_VERSION,
  }
  writeCatalog(dataDir, [entry, ...readCatalog(dataDir)])
  return entry
}

/**
 * Re-derives title/composer for every entry stamped with an older
 * METADATA_VERSION, so scores already in the catalog benefit from a change to
 * the extraction rules. Runs once at startup; a no-op on an up-to-date catalog,
 * so it costs a single JSON read in the normal case.
 */
export async function migrateCatalog(dataDir: string): Promise<void> {
  const entries = readCatalog(dataDir)
  const stale = entries.filter((entry) => entry.metadataVersion !== METADATA_VERSION)
  if (stale.length === 0) {
    return
  }
  for (const entry of stale) {
    // Stamped even when the file can't be read, so an orphaned entry isn't
    // re-parsed from disk on every single restart.
    entry.metadataVersion = METADATA_VERSION
    entry.composer = entry.composer ?? null
    const file = scoreFilePath(dataDir, entry)
    if (!file) {
      continue
    }
    try {
      const metadata = await extractScoreMetadata(entry.filename, readFileSync(file))
      entry.title = metadata.title ?? titleFromFilename(entry.filename)
      entry.composer = metadata.composer
    } catch (error: unknown) {
      // One unreadable score must not stop the others from being upgraded.
      console.error(`[catalog] could not read metadata for ${entry.filename}:`, error)
    }
  }
  writeCatalog(dataDir, entries)
  console.log(`[catalog] refreshed metadata for ${stale.length} score(s)`)
}
