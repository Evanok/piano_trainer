import type { PracticeSessionRecord } from '../types/session'
import { MAX_STORED_SESSIONS, sortSessions, upsertSession } from './sessionLog'

/**
 * Device-local session log. Deliberately a new key rather than a migration of
 * the old 'piano-trainer:exercise-sessions' one: that store only ever held
 * completed generated exercises, with no start time, no source description and
 * no notion of an abandoned run, so there was nothing worth carrying over.
 */
const STORAGE_KEY = 'piano-trainer:sessions'

/**
 * Whether the server has seen this device's latest writes, as two counters:
 * every local write bumps the first, and a successful sync stores the value
 * it started from in the second. Counters rather than a flag, so a session
 * saved while a sync is in flight is not marked as sent by that sync. Kept in
 * storage, so a session left unsent by a tab killed mid-practice is still
 * pushed after a reload.
 */
const WRITE_VERSION_KEY = 'piano-trainer:sessions-write-version'
const SYNCED_VERSION_KEY = 'piano-trainer:sessions-synced-version'

function readCounter(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeCounter(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // Storage unavailable: the next screen simply syncs again.
  }
}

/** The local write counter, to hand back to markSyncedUpTo once a sync succeeds. */
export function sessionWriteVersion(): number {
  return readCounter(WRITE_VERSION_KEY) ?? 0
}

/**
 * True when something was written locally since the last successful sync. A
 * device that has never recorded a sync answers true, since its log may hold
 * sessions from before this bookkeeping existed.
 */
export function hasUnsyncedSessions(): boolean {
  const synced = readCounter(SYNCED_VERSION_KEY)
  return synced === null || synced !== sessionWriteVersion()
}

export function markSyncedUpTo(version: number): void {
  writeCounter(SYNCED_VERSION_KEY, version)
}

export function getSessions(): PracticeSessionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as PracticeSessionRecord[]) : []
    return Array.isArray(parsed) ? sortSessions(parsed) : []
  } catch {
    return []
  }
}

function writeSessions(sessions: PracticeSessionRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_STORED_SESSIONS)))
  } catch {
    // Storage unavailable (private browsing, quota) -- history just won't persist.
  }
}

/**
 * Writes one session, replacing the previous snapshot of the same id. Called
 * when a session starts, periodically while it runs, and when it ends, so the
 * log is never missing a session that is still in progress.
 */
export function saveSession(record: PracticeSessionRecord): void {
  writeSessions(upsertSession(getSessions(), record))
  writeCounter(WRITE_VERSION_KEY, sessionWriteVersion() + 1)
}

/** Replaces the whole local log, used after a merge with the server's copy. */
export function replaceSessions(sessions: PracticeSessionRecord[]): void {
  writeSessions(sortSessions(sessions))
}
