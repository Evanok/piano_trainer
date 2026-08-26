import { countedSessions } from './sessionLog.ts'
import type { PracticeSessionRecord } from '../types/session.ts'

/**
 * How far through a piece the player has actually got, per catalog entry.
 *
 * Pure and DOM-free like the rest of engine/, and deliberately importable by the
 * server (hence the explicit .ts specifiers, same reason sessionLog.ts carries
 * them): the catalog listing computes this from the *shared* history in
 * stats.json rather than from whatever the current device happens to hold, so a
 * piece practised on the phone shows its progress on the desktop, and a guest
 * link sees it too without having opened the stats screen first.
 */
export interface ScorePlayProgress {
  /** Furthest point reached, 0-100. 100 exactly when a session finished it. */
  percent: number
  /** True once any session played the piece through to its last event. */
  completed: boolean
  /** How many practice sessions this piece has, for the "most played" sort. */
  sessionCount: number
  /** ISO-8601 start of the most recent session, for the "last played" sort. */
  lastPlayedAt: string
}

/**
 * One session's reach, as a percentage of the piece.
 *
 * `furthestEventIndex` is the high-water mark of the cursor, so working a hard
 * passage and then jumping back to the start does not undo the session's
 * progress; it is optional because sessions recorded before it existed have
 * only `eventsPlayed` (the cursor's *final* position), which is the same number
 * for the common straight-through run.
 *
 * The denominator is the session's own `totalEvents`, which depends on its hand
 * mode (a right-hand-only run has fewer events), so this stays a ratio of the
 * piece as that session played it rather than mixing two scales.
 */
export function sessionReachedPercent(session: PracticeSessionRecord): number {
  if (session.completed) {
    return 100
  }
  if (!Number.isFinite(session.totalEvents) || session.totalEvents <= 0) {
    return 0
  }
  const reached = session.furthestEventIndex ?? session.eventsPlayed
  if (!Number.isFinite(reached) || reached <= 0) {
    return 0
  }
  // Capped at 99 below: 100 is reserved for a session that actually finished,
  // so a full bar always means the piece was played to its end rather than
  // rounded up from its second-to-last event.
  return Math.max(0, Math.min(99, Math.round((100 * reached) / session.totalEvents)))
}

/**
 * Keyed by catalog id, so one-off uploads (which have none) are left out: they
 * have no row in the catalog to show progress on.
 *
 * Counts only practice-worthy sessions (`countedSessions`), the same filter the
 * stats screen and the streak use, so a score merely opened and closed does not
 * end up with a progress bar.
 */
export function progressByCatalogId(sessions: PracticeSessionRecord[]): Map<string, ScorePlayProgress> {
  const byId = new Map<string, ScorePlayProgress>()
  for (const session of countedSessions(sessions)) {
    if (session.source.kind !== 'score' || !session.source.catalogId) {
      continue
    }
    const id = session.source.catalogId
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, {
        percent: sessionReachedPercent(session),
        completed: session.completed,
        sessionCount: 1,
        lastPlayedAt: session.startedAt,
      })
      continue
    }
    existing.percent = Math.max(existing.percent, sessionReachedPercent(session))
    existing.completed = existing.completed || session.completed
    existing.sessionCount += 1
    // ISO-8601 compares lexicographically in chronological order.
    if (session.startedAt > existing.lastPlayedAt) {
      existing.lastPlayedAt = session.startedAt
    }
  }
  return byId
}
