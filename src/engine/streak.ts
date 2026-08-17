import { countedSessions } from './sessionLog'
import { getSessions } from './sessionStore'
import { computeStreak, type StreakStats } from './statsAnalytics'

export type { StreakStats }

/**
 * Practice streak of the device-local session log. There is no streak store of
 * its own any more: every session is recorded the moment practice starts, so the
 * log already knows which days were practiced (see computeStreak).
 *
 * Only sessions that count as practice feed it (see isCountedSession) -- opening
 * a score and going straight back must not earn a streak day.
 */
export function getStreakStats(now: Date = new Date()): StreakStats {
  return computeStreak(countedSessions(getSessions()), now)
}
