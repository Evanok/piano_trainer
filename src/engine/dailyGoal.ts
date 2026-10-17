import { countedSessions } from './sessionLog'
import { dailyMinutes } from './statsAnalytics'
import type { PracticeSessionRecord } from '../types/session'

/**
 * The daily practice goal shown on Home: minutes played today against a
 * target the player picks. It counts exactly what the streak and the calendar
 * count (see isCountedSession), every activity included, so a quiz on the
 * phone moves it just as it keeps the streak alive.
 */
export const DEFAULT_DAILY_GOAL_MINUTES = 20

/** The targets offered. A free number field would be one more thing to type on a phone. */
export const DAILY_GOAL_CHOICES = [5, 10, 15, 20, 30, 45, 60, 90]

export interface DailyGoalPreference {
  minutes: number
}

export const DEFAULT_DAILY_GOAL: DailyGoalPreference = { minutes: DEFAULT_DAILY_GOAL_MINUTES }

export interface DailyGoalProgress {
  minutes: number
  goalMinutes: number
  /** 0 to 100, capped: going past the goal fills the bar, it does not overflow it. */
  percent: number
  reached: boolean
}

export function dailyGoalProgress(
  sessions: PracticeSessionRecord[],
  goalMinutes: number,
  now: Date = new Date(),
): DailyGoalProgress {
  const [today] = dailyMinutes(countedSessions(sessions), 1, now)
  const minutes = today?.minutes ?? 0
  const goal = Math.max(1, goalMinutes)
  return {
    minutes,
    goalMinutes: goal,
    percent: Math.min(100, Math.round((minutes / goal) * 100)),
    reached: minutes >= goal,
  }
}
