import { describe, expect, it } from 'vitest'
import { dailyGoalProgress } from './dailyGoal'
import type { PracticeSessionRecord } from '../types/session'

const NOW = new Date(2026, 9, 16, 20, 0, 0)

function session(startedAt: Date, durationMs: number, overrides: Partial<PracticeSessionRecord> = {}): PracticeSessionRecord {
  return {
    id: `session-${startedAt.getTime()}-${durationMs}`,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
    durationMs,
    completed: false,
    practiceMode: 'scroll',
    handMode: 'both',
    source: { kind: 'score', title: 'Test', scoreName: 'test.mxl', catalogId: null },
    totalEvents: 100,
    eventsPlayed: 10,
    errorCount: 1,
    correctNoteCount: 20,
    successPercent: 90,
    maxCombo: 5,
    notes: {
      responseCount: 0,
      averageResponseMs: 0,
      medianResponseMs: 0,
      slowestResponseMs: 0,
      missedNotes: [],
      wrongNotes: [],
      confusions: [],
    },
    ...overrides,
  }
}

function todayAt(hour: number): Date {
  const date = new Date(NOW)
  date.setHours(hour, 0, 0, 0)
  return date
}

describe('dailyGoalProgress', () => {
  it('sums today\'s sessions against the goal', () => {
    const progress = dailyGoalProgress([session(todayAt(9), 5 * 60000), session(todayAt(18), 7 * 60000)], 20, NOW)
    expect(progress).toEqual({ minutes: 12, goalMinutes: 20, percent: 60, reached: false })
  })

  it('ignores yesterday and sessions that do not count as practice', () => {
    const yesterday = new Date(todayAt(10))
    yesterday.setDate(yesterday.getDate() - 1)
    const opened = session(todayAt(11), 30 * 60000, { correctNoteCount: 0, errorCount: 0 })
    const progress = dailyGoalProgress([session(yesterday, 30 * 60000), opened], 20, NOW)
    expect(progress.minutes).toBe(0)
    expect(progress.reached).toBe(false)
  })

  it('caps the bar at the goal once it is passed', () => {
    const progress = dailyGoalProgress([session(todayAt(9), 45 * 60000)], 20, NOW)
    expect(progress.percent).toBe(100)
    expect(progress.reached).toBe(true)
  })
})
