import type { PracticeSessionRecord } from '../types/session.ts'
import type { ReadingQuizSettings } from '../types/reading.ts'
import type { NoteSequenceSettings } from '../types/sequence.ts'
import type { ExerciseRequest } from '../types/training.ts'

/**
 * Pure session-log operations, with no storage of their own. Shared by the
 * browser-side store (sessionStore.ts, localStorage) and the server-side one
 * (server/statsStore.ts, stats.json) so both agree on ordering and on how two
 * logs merge -- the sync endpoint is only safe because merging is defined once.
 *
 * The imports above (and the type chain they pull in) carry explicit .ts
 * extensions on purpose: the server typechecks under nodenext resolution, which
 * rejects extensionless relative specifiers, so any src/ module the server
 * reaches has to spell them out -- same reason src/types/catalog.ts is imported
 * that way by server/catalogApi.ts.
 */

/** Kept on the device; the server holds more (see server/statsStore.ts). */
export const MAX_STORED_SESSIONS = 500

/**
 * Id for a new session record: 128 random bits, hex. Only has to be unique
 * across devices, since it is the key the two logs merge on.
 *
 * Deliberately NOT crypto.randomUUID(): that one is spec'd [SecureContext], and
 * this app's production deployment is plain HTTP on a bare IP and port (no
 * reverse proxy, no TLS -- see README), where it is simply absent. It threw
 * "crypto.randomUUID is not a function" on the practice screen in production
 * while working fine in development, because localhost counts as a secure
 * context and dev therefore never saw it. crypto.getRandomValues has no such
 * restriction; Math.random is the last-resort fallback, weaker but still fine
 * for a local id that guards nothing.
 *
 * Anything else added here must hold to the same rule: no secure-context-only
 * API without a guarded fallback.
 */
export function createSessionId(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Below this, an unfinished session reads as a false start rather than practice. */
export const MIN_COUNTED_SESSION_MS = 60000

/**
 * Whether a session counts as practice for everything the player is shown --
 * the stats screen, and the streak with it.
 *
 * Sessions are recorded from the moment the practice screen opens (so that
 * quitting early still counts, and so a killed tab still leaves a record), which
 * means the log necessarily also holds screens that were merely opened. Those
 * must not inflate session counts, weekly minutes or averages, and above all
 * must not earn a streak day for walking past the app.
 *
 * A finished session always counts, however short: a generated 8-measure drill
 * played cleanly in 45 seconds is real practice, and hiding it for being brief
 * would lose information. Only an *unfinished* sub-minute visit is dropped.
 *
 * This filters at display time and never deletes anything, so the threshold can
 * be revised later without having lost the sessions it once excluded.
 */
export function isCountedSession(session: PracticeSessionRecord): boolean {
  const playedSomething = session.correctNoteCount > 0 || session.errorCount > 0
  if (!playedSomething) {
    return false
  }
  return session.completed || session.durationMs >= MIN_COUNTED_SESSION_MS
}

export function countedSessions(sessions: PracticeSessionRecord[]): PracticeSessionRecord[] {
  return sessions.filter(isCountedSession)
}

/**
 * Newest first, by start time. The id breaks ties: two sessions can share a
 * millisecond (one device replaying immediately, or two devices syncing), and
 * an unstable order there would make rows jump around between renders -- the
 * same reason catalogQuery sorts by uploadedAt with an id tie-break.
 */
export function sortSessions(sessions: PracticeSessionRecord[]): PracticeSessionRecord[] {
  return [...sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.id < b.id ? 1 : -1))
}

/**
 * Replaces the record with the same id, or adds it. Sessions are written
 * repeatedly while they run (see sessionStore.saveSession), so an upsert --
 * not an append -- is the normal write path.
 */
export function upsertSession(
  sessions: PracticeSessionRecord[],
  record: PracticeSessionRecord,
  limit = MAX_STORED_SESSIONS,
): PracticeSessionRecord[] {
  const others = sessions.filter((session) => session.id !== record.id)
  return sortSessions([record, ...others]).slice(0, limit)
}

/**
 * Union of two logs by id. Both sides are append-only sets of immutable-ish
 * records, so there is no conflict to resolve in the usual sense: the only way
 * two records share an id is being two snapshots of the same session, and the
 * later snapshot (longer duration, or completed) is always the better one.
 * That is what makes the sync endpoint a plain merge with no revision numbers,
 * no clock comparison, and no last-write-wins data loss.
 */
export function mergeSessionLogs(
  a: PracticeSessionRecord[],
  b: PracticeSessionRecord[],
  limit = MAX_STORED_SESSIONS,
): PracticeSessionRecord[] {
  const byId = new Map<string, PracticeSessionRecord>()
  for (const record of [...a, ...b]) {
    const existing = byId.get(record.id)
    if (!existing || isBetterSnapshot(record, existing)) {
      byId.set(record.id, record)
    }
  }
  return sortSessions(Array.from(byId.values())).slice(0, limit)
}

function isBetterSnapshot(candidate: PracticeSessionRecord, existing: PracticeSessionRecord): boolean {
  if (candidate.completed !== existing.completed) {
    return candidate.completed
  }
  return candidate.durationMs > existing.durationMs
}

const HAND_LABELS: Record<string, string> = {
  right: 'right hand',
  left: 'left hand',
  both: 'both hands',
}

const CONTENT_LABELS: Record<string, string> = {
  notes: 'Notes',
  triads: 'Triads',
  mixed: 'Notes + triads',
}

/**
 * The label stored in a session record for a reading quiz, same idea as
 * exerciseSessionTitle below: computed once, so the stats screen never needs to
 * know what a clef mode or a ledger level is.
 */
/**
 * "Note order - downwards, next note". Denormalized onto the record like every
 * other session title, so the stats screen never has to know what the settings
 * mean.
 */
export function sequenceSessionTitle(settings: NoteSequenceSettings): string {
  const direction =
    settings.direction === 'mixed'
      ? 'both ways'
      : settings.direction === 'down'
        ? 'downwards'
        : 'upwards'
  const distance =
    settings.distance === 'mixed'
      ? 'seconds and thirds'
      : settings.distance === 'third'
        ? 'thirds'
        : 'next note'
  return `Note order - ${direction}, ${distance}`
}

export function readingSessionTitle(settings: ReadingQuizSettings): string {
  const clef =
    settings.clefMode === 'both'
      ? 'both clefs'
      : settings.clefMode === 'bass'
        ? 'bass clef'
        : 'treble clef'
  const ledger =
    settings.ledgerLevel === 0
      ? 'on the staff'
      : `up to ${settings.ledgerLevel} ledger line${settings.ledgerLevel > 1 ? 's' : ''}`
  return `Reading - ${clef}, ${ledger}`
}

/**
 * The label stored in a session record for an exercise. Computed once when the
 * session starts rather than derived at display time, so the stats screen never
 * has to know anything about generator settings (see SessionSource.title).
 */
export function exerciseSessionTitle(request: ExerciseRequest, keyName: string | null): string {
  const key = keyName ?? request.settings.key
  const hand = HAND_LABELS[request.settings.handMode] ?? request.settings.handMode
  if (request.kind === 'hanon') {
    const length = request.settings.length === 'ascending' ? ', ascending' : ''
    return `Hanon #${request.settings.exerciseNumber} - ${key} - ${hand}${length}`
  }
  const content = CONTENT_LABELS[request.settings.contentMode] ?? request.settings.contentMode
  return `${content} - ${key} - ${hand} (${request.settings.difficulty})`
}
