import { AuthRequiredError, authHeaders, isGuest, notifyAuthRequired } from './auth'
import { mergeSessionLogs } from '../engine/sessionLog'
import {
  getSessions,
  hasUnsyncedSessions,
  markSyncedUpTo,
  replaceSessions,
  sessionWriteVersion,
} from '../engine/sessionStore'
import type { PracticeSessionRecord } from '../types/session'

/**
 * Practice history sync. One endpoint, one round-trip: the device posts its own
 * log and gets the merged history back (see server/statsStore.ts). Nothing here
 * is required for practising -- an unreachable server just means the stats
 * screen shows this device's own log, same degradation as the catalog.
 */
export async function syncSessions(sessions: PracticeSessionRecord[]): Promise<PracticeSessionRecord[]> {
  const response = await fetch('/api/stats/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sessions }),
  })
  if (!response.ok) {
    if (response.status === 401) {
      notifyAuthRequired()
      throw new AuthRequiredError()
    }
    throw new Error(`${response.status} ${response.statusText}`)
  }
  const body = (await response.json()) as { sessions?: PracticeSessionRecord[] }
  return Array.isArray(body.sessions) ? body.sessions : []
}

/**
 * Read-only counterpart of the sync, used by a guest session: it must see the
 * owner's history without pushing anything into it (the server refuses the sync
 * for a guest anyway, this just avoids asking).
 */
export async function fetchSessions(): Promise<PracticeSessionRecord[]> {
  const response = await fetch('/api/stats', { headers: authHeaders() })
  if (!response.ok) {
    if (response.status === 401) {
      notifyAuthRequired()
      throw new AuthRequiredError()
    }
    throw new Error(`${response.status} ${response.statusText}`)
  }
  const body = (await response.json()) as { sessions?: PracticeSessionRecord[] }
  return Array.isArray(body.sessions) ? body.sessions : []
}

/**
 * Brings this device's stored log up to date with the shared history and
 * returns it: the one sync every screen that reads the log performs, so the
 * stats screen and Home cannot disagree on what was played elsewhere.
 *
 * A guest reads the shared history but never pushes into it, so it pulls
 * instead of syncing. Merging rather than replacing keeps a device that has
 * its own local history from losing it just because someone opened a guest
 * link in that browser. Throws when the server cannot be reached, leaving the
 * local log untouched.
 */
export async function syncLocalSessionLog(): Promise<PracticeSessionRecord[]> {
  const guest = isGuest()
  const version = sessionWriteVersion()
  const remote = guest ? await fetchSessions() : await syncSessions(getSessions())
  const merged = guest ? mergeSessionLogs(getSessions(), remote) : remote
  replaceSessions(merged)
  if (!guest) {
    markSyncedUpTo(version)
  }
  return merged
}

/**
 * Pushes this device's log only when it holds writes the server has not seen
 * (a session just played, typically), and answers whether it did. For screens
 * that read history the server derives (the catalog's progress and "last
 * played"), which need the device's latest sessions on the server but not the
 * merged log back. Coming from Home, which has just synced, it sends nothing.
 * A guest never pushes. Throws when the server cannot be reached.
 */
export async function pushUnsyncedSessions(): Promise<boolean> {
  if (isGuest() || !hasUnsyncedSessions()) {
    return false
  }
  await syncLocalSessionLog()
  return true
}
