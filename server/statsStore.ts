import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mergeSessionLogs } from '../src/engine/sessionLog.ts'
import type { PracticeSessionRecord } from '../src/types/session.ts'

/**
 * Server-side practice history: one shared profile, since there is no account
 * system and this is a single-user deployment. Same shape as the device-local
 * log (src/engine/sessionStore.ts) and merged with the very same function, so a
 * phone and a desktop converge on the union of what they each recorded.
 */

/** Far above the per-device cap: the server is the copy that keeps everything. */
export const MAX_SERVER_SESSIONS = 20000

function statsPath(dataDir: string): string {
  return path.join(dataDir, 'stats.json')
}

export function readSessions(dataDir: string): PracticeSessionRecord[] {
  const file = statsPath(dataDir)
  if (!existsSync(file)) {
    return []
  }
  // A corrupt file throws rather than reading as empty -- an empty history
  // would be merged into (and then overwrite) the real one on the next sync,
  // which is exactly the data loss this whole endpoint exists to prevent.
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON array`)
  }
  return parsed as PracticeSessionRecord[]
}

function writeSessions(dataDir: string, sessions: PracticeSessionRecord[]): void {
  mkdirSync(dataDir, { recursive: true })
  // Write-then-rename, same as the catalog: a crash mid-write leaves the
  // previous history intact instead of a truncated file that throws on read.
  const temporary = `${statsPath(dataDir)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(sessions, null, 2)}\n`, 'utf8')
  renameSync(temporary, statsPath(dataDir))
}

/**
 * Drops anything that isn't recognisably a session record. The payload comes
 * from a browser, so it can't be trusted to be well-formed; one bad entry must
 * not make the stored history unreadable for every later read.
 */
export function sanitizeSessions(raw: unknown): PracticeSessionRecord[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((candidate): candidate is PracticeSessionRecord => {
    if (typeof candidate !== 'object' || candidate === null) {
      return false
    }
    const record = candidate as Partial<PracticeSessionRecord>
    const notes = record.notes as Partial<PracticeSessionRecord['notes']> | undefined
    return (
      typeof record.id === 'string' &&
      record.id.length > 0 &&
      typeof record.startedAt === 'string' &&
      !Number.isNaN(Date.parse(record.startedAt)) &&
      typeof record.durationMs === 'number' &&
      Number.isFinite(record.durationMs) &&
      typeof record.completed === 'boolean' &&
      typeof record.source === 'object' &&
      record.source !== null &&
      typeof notes === 'object' &&
      notes !== null &&
      Array.isArray(notes.missedNotes) &&
      Array.isArray(notes.wrongNotes) &&
      Array.isArray(notes.confusions)
    )
  })
}

/**
 * Merges what a device has into the stored history and returns the result, which
 * is also what that device then stores locally. Idempotent: syncing the same log
 * twice changes nothing, so a retry after a flaky connection is free.
 */
export function syncSessions(dataDir: string, incoming: unknown): PracticeSessionRecord[] {
  const merged = mergeSessionLogs(readSessions(dataDir), sanitizeSessions(incoming), MAX_SERVER_SESSIONS)
  writeSessions(dataDir, merged)
  return merged
}
