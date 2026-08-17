import type { PracticeSessionRecord } from '../types/session'
import { MAX_STORED_SESSIONS, sortSessions, upsertSession } from './sessionLog'

/**
 * Device-local session log. Deliberately a new key rather than a migration of
 * the old 'piano-trainer:exercise-sessions' one: that store only ever held
 * completed generated exercises, with no start time, no source description and
 * no notion of an abandoned run, so there was nothing worth carrying over.
 */
const STORAGE_KEY = 'piano-trainer:sessions'

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
}

/** Replaces the whole local log, used after a merge with the server's copy. */
export function replaceSessions(sessions: PracticeSessionRecord[]): void {
  writeSessions(sortSessions(sessions))
}
