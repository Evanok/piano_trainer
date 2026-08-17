import { AuthRequiredError, authHeaders, notifyAuthRequired } from './auth'
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
