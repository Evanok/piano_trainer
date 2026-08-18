import { describe, expect, it } from 'vitest'
import {
  computeStreak,
  dailyMinutes,
  groupPracticeBlocks,
  localDayString,
  percentChange,
  sessionsInLastDays,
  summarizeAllTime,
  summarizeRecent,
  summarizeScores,
} from './statsAnalytics'
import type { ExerciseSessionStats, PracticeSessionRecord } from '../types/session'

const NOW = new Date(2026, 7, 17, 18, 0, 0)

// Local, not UTC: every day boundary in these aggregates is the player's own
// (see localDayString), so a UTC-built fixture would land on the wrong day for
// anyone west of Greenwich.
function daysAgo(days: number, hour = 10): Date {
  const date = new Date(NOW)
  date.setDate(date.getDate() - days)
  date.setHours(hour, 0, 0, 0)
  return date
}

function notes(overrides: Partial<ExerciseSessionStats> = {}): ExerciseSessionStats {
  return {
    responseCount: 0,
    averageResponseMs: 0,
    medianResponseMs: 0,
    slowestResponseMs: 0,
    missedNotes: [],
    wrongNotes: [],
    confusions: [],
    ...overrides,
  }
}

let nextId = 0

function session(startedAt: Date, overrides: Partial<PracticeSessionRecord> = {}): PracticeSessionRecord {
  nextId += 1
  const durationMs = overrides.durationMs ?? 600000
  return {
    id: `session-${nextId}`,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
    durationMs,
    completed: true,
    practiceMode: 'scroll',
    handMode: 'both',
    source: { kind: 'score', title: 'Clair de Lune', scoreName: 'clair.mxl', catalogId: null },
    totalEvents: 100,
    eventsPlayed: 100,
    errorCount: 2,
    correctNoteCount: 102,
    successPercent: 90,
    maxCombo: 10,
    notes: notes(),
    ...overrides,
  }
}

// A session's endedAt is startedAt + durationMs (see the fixture), so a gap is
// controlled by starting the next one that many minutes after the previous end.
function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000)
}

describe('groupPracticeBlocks', () => {
  it('groups pieces worked back to back into one sitting', () => {
    const first = daysAgo(0, 10)
    const sessions = [
      session(first, { durationMs: 600000 }),
      session(minutesAfter(first, 12), { durationMs: 600000 }),
      session(minutesAfter(first, 25), { durationMs: 600000 }),
    ]

    const blocks = groupPracticeBlocks(sessions)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].sessions).toHaveLength(3)
    // Practice time, not the wall-clock span (which would include the breaks).
    expect(blocks[0].durationMs).toBe(1800000)
    expect(blocks[0].startedAt).toBe(first.toISOString())
  })

  it('starts a new sitting once the break is longer than the gap', () => {
    const first = daysAgo(0, 10)
    const sessions = [session(first, { durationMs: 600000 }), session(minutesAfter(first, 40), { durationMs: 600000 })]

    expect(groupPracticeBlocks(sessions)).toHaveLength(2)
  })

  it('honours a custom gap', () => {
    const first = daysAgo(0, 10)
    const sessions = [session(first, { durationMs: 600000 }), session(minutesAfter(first, 40), { durationMs: 600000 })]

    expect(groupPracticeBlocks(sessions, 60 * 60000)).toHaveLength(1)
  })

  it('returns sittings newest first, each holding its sessions newest first', () => {
    const morning = daysAgo(0, 9)
    const evening = daysAgo(0, 20)
    const sessions = [
      session(morning, { durationMs: 600000 }),
      session(minutesAfter(morning, 5), { durationMs: 600000 }),
      session(evening, { durationMs: 600000 }),
    ]

    const blocks = groupPracticeBlocks(sessions)

    expect(blocks.map((block) => block.startedAt)).toEqual([evening.toISOString(), morning.toISOString()])
    expect(blocks[1].sessions[0].startedAt).toBe(minutesAfter(morning, 5).toISOString())
  })

  it('aggregates the sitting from its sessions', () => {
    const first = daysAgo(0, 10)
    const sessions = [
      session(first, { durationMs: 600000, errorCount: 4, successPercent: 80, maxCombo: 5, completed: true }),
      session(minutesAfter(first, 5), { durationMs: 600000, errorCount: 6, successPercent: 90, maxCombo: 30, completed: false }),
    ]

    expect(groupPracticeBlocks(sessions)[0]).toMatchObject({
      errorCount: 10,
      successPercent: 85,
      maxCombo: 30,
      completedCount: 1,
    })
  })

  it('has nothing to group in an empty log', () => {
    expect(groupPracticeBlocks([])).toEqual([])
  })
})

describe('computeStreak', () => {
  it('counts a run that includes today', () => {
    const sessions = [session(daysAgo(0)), session(daysAgo(1)), session(daysAgo(2))]

    expect(computeStreak(sessions, NOW)).toMatchObject({ currentStreak: 3, longestStreak: 3, totalDaysPracticed: 3 })
  })

  it('keeps the streak alive when the last practice was yesterday', () => {
    expect(computeStreak([session(daysAgo(1)), session(daysAgo(2))], NOW).currentStreak).toBe(2)
  })

  it('drops the current streak once a full day was missed', () => {
    const streak = computeStreak([session(daysAgo(2)), session(daysAgo(3))], NOW)

    expect(streak.currentStreak).toBe(0)
    expect(streak.longestStreak).toBe(2)
  })

  it('counts several sessions on one day as a single practice day', () => {
    const sessions = [session(daysAgo(0, 9)), session(daysAgo(0, 14)), session(daysAgo(0, 20))]

    expect(computeStreak(sessions, NOW)).toMatchObject({ currentStreak: 1, totalDaysPracticed: 1 })
  })

  it('reports nothing for an empty log', () => {
    expect(computeStreak([], NOW)).toEqual({ currentStreak: 0, longestStreak: 0, totalDaysPracticed: 0 })
  })
})

describe('sessionsInLastDays', () => {
  it('includes today and excludes anything older than the window', () => {
    const sessions = [session(daysAgo(0)), session(daysAgo(6)), session(daysAgo(7)), session(daysAgo(30))]

    expect(sessionsInLastDays(sessions, 7, NOW)).toHaveLength(2)
  })
})

describe('summarizeRecent', () => {
  it('averages duration and accuracy over the window only', () => {
    const sessions = [
      session(daysAgo(0), { durationMs: 600000, successPercent: 80 }),
      session(daysAgo(2), { durationMs: 1200000, successPercent: 100 }),
      session(daysAgo(40), { durationMs: 60000, successPercent: 10 }),
    ]

    const recent = summarizeRecent(sessions, 7, NOW)

    expect(recent.sessionCount).toBe(2)
    // Two sittings a day apart, so per-sitting equals per-session here.
    expect(recent.blockCount).toBe(2)
    expect(recent.averageBlockMs).toBe(900000)
    expect(recent.averageSuccessPercent).toBe(90)
    expect(recent.blocksPerWeek).toBe(2)
    expect(recent.longestBlockMs).toBe(1200000)
  })

  it('weights average response time by how many responses each session had', () => {
    const sessions = [
      session(daysAgo(0), { notes: notes({ responseCount: 100, averageResponseMs: 1000 }) }),
      session(daysAgo(1), { notes: notes({ responseCount: 1, averageResponseMs: 9000 }) }),
    ]

    // A one-note session must not drag the average up to 5000.
    expect(summarizeRecent(sessions, 7, NOW).averageResponseMs).toBe(1079)
  })
})

describe('summarizeAllTime', () => {
  it('spreads the weekly rate over at least one week, not over the first day', () => {
    const sessions = [session(daysAgo(0, 9)), session(daysAgo(0, 15))]

    // 2 sittings on a single day is "2 per week", never an extrapolated 14.
    expect(summarizeAllTime(sessions, NOW).blocksPerWeek).toBe(2)
  })

  it('spreads the weekly rate over the days since the first session', () => {
    const sessions = [session(daysAgo(0)), session(daysAgo(13))]

    // 14 days spanned = exactly 2 weeks.
    expect(summarizeAllTime(sessions, NOW).blocksPerWeek).toBe(1)
  })

  it('counts an abandoned session but reports it separately', () => {
    const sessions = [session(daysAgo(0)), session(daysAgo(1), { completed: false })]

    const allTime = summarizeAllTime(sessions, NOW)

    expect(allTime.sessionCount).toBe(2)
    expect(allTime.completedCount).toBe(1)
  })
})

describe('percentChange', () => {
  it('is signed and rounded', () => {
    expect(percentChange(12, 10)).toBe(20)
    expect(percentChange(8, 10)).toBe(-20)
  })

  it('has no answer without a baseline', () => {
    expect(percentChange(5, 0)).toBeNull()
  })
})

describe('dailyMinutes', () => {
  it('returns one entry per day, oldest first, including empty days', () => {
    const days = dailyMinutes([session(daysAgo(0), { durationMs: 900000 })], 14, NOW)

    expect(days).toHaveLength(14)
    expect(days[0].day).toBe(localDayString(daysAgo(13)))
    expect(days[13]).toEqual({ day: localDayString(NOW), minutes: 15, sessionCount: 1 })
    expect(days[12].minutes).toBe(0)
  })

  it('sums every session of the same day', () => {
    const sessions = [session(daysAgo(1, 9), { durationMs: 300000 }), session(daysAgo(1, 20), { durationMs: 600000 })]

    const yesterday = dailyMinutes(sessions, 7, NOW).find((entry) => entry.day === localDayString(daysAgo(1)))

    expect(yesterday).toEqual({ day: localDayString(daysAgo(1)), minutes: 15, sessionCount: 2 })
  })
})

describe('summarizeScores', () => {
  it('groups sessions of the same score and keeps the best accuracy', () => {
    const sessions = [
      session(daysAgo(2), { successPercent: 60 }),
      session(daysAgo(0), { successPercent: 85 }),
    ]

    const scores = summarizeScores(sessions)

    expect(scores).toHaveLength(1)
    expect(scores[0].sessionCount).toBe(2)
    expect(scores[0].bestSuccessPercent).toBe(85)
    expect(scores[0].lastPlayedAt).toBe(daysAgo(0).toISOString())
  })

  it('keeps two scores separate when their catalog id or file name differs', () => {
    const sessions = [
      session(daysAgo(1), {
        source: { kind: 'score', title: 'Clair de Lune', scoreName: 'clair.mxl', catalogId: null },
        successPercent: 70,
      }),
      session(daysAgo(0), {
        source: { kind: 'score', title: 'Für Elise', scoreName: 'elise.mxl', catalogId: 'abc' },
        successPercent: 95,
      }),
    ]

    expect(summarizeScores(sessions).map((score) => score.title)).toEqual(['Für Elise', 'Clair de Lune'])
  })

  it('ignores generated exercises and never invents a sheet with no session', () => {
    const sessions = [
      session(daysAgo(0), {
        source: { kind: 'exercise', title: 'Random exercise', exercise: {} as never, keyName: null },
      }),
    ]

    expect(summarizeScores(sessions)).toEqual([])
  })

  it('uses the most recently played session title, in case the catalog title was edited since', () => {
    const sessions = [
      session(daysAgo(1), {
        source: { kind: 'score', title: 'Old Title', scoreName: 'piece.mxl', catalogId: 'xyz' },
      }),
      session(daysAgo(0), {
        source: { kind: 'score', title: 'New Title', scoreName: 'piece.mxl', catalogId: 'xyz' },
      }),
    ]

    expect(summarizeScores(sessions)[0].title).toBe('New Title')
  })
})
