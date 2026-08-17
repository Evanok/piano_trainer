import type { PracticeSessionRecord } from '../types/session.ts'
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
