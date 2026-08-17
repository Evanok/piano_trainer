import { getSessions } from './sessionStore'
import { computeStreak, type StreakStats } from './statsAnalytics'

export type { StreakStats }

/**
 * Practice streak of the device-local session log. There is no streak store of
 * its own any more: every session is recorded the moment practice starts, so the
 * log already knows which days were practiced (see computeStreak).
 */
export function getStreakStats(now: Date = new Date()): StreakStats {
  return computeStreak(getSessions(), now)
}
