import { beforeEach, describe, expect, it } from 'vitest'
import { getStreakStats, recordPracticeDay } from './streakStore'

// No jsdom/happy-dom in this project's vitest setup (WaitEngine.test.ts is
// pure Node), so localStorage isn't a real global here -- a minimal in-memory
// stand-in is enough since streakStore only calls getItem/setItem.
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

function day(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d)
}

describe('streakStore', () => {
  it('reports all zeros with no practice history', () => {
    expect(getStreakStats(day(2026, 7, 26))).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      totalDaysPracticed: 0,
    })
  })

  it('counts a single practiced day as a streak of 1', () => {
    recordPracticeDay(day(2026, 7, 26))
    expect(getStreakStats(day(2026, 7, 26))).toEqual({
      currentStreak: 1,
      longestStreak: 1,
      totalDaysPracticed: 1,
    })
  })

  it('recording the same day twice does not inflate totalDaysPracticed', () => {
    recordPracticeDay(day(2026, 7, 26))
    recordPracticeDay(day(2026, 7, 26))
    expect(getStreakStats(day(2026, 7, 26)).totalDaysPracticed).toBe(1)
  })

  it('builds a current streak across consecutive days', () => {
    recordPracticeDay(day(2026, 7, 24))
    recordPracticeDay(day(2026, 7, 25))
    recordPracticeDay(day(2026, 7, 26))
    expect(getStreakStats(day(2026, 7, 26))).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      totalDaysPracticed: 3,
    })
  })

  it('keeps the streak alive if the last practiced day was yesterday', () => {
    recordPracticeDay(day(2026, 7, 24))
    recordPracticeDay(day(2026, 7, 25))
    // "now" is the 26th, but nothing was practiced yet today -- streak should
    // still read as alive (2), not reset to 0, since today isn't over yet.
    expect(getStreakStats(day(2026, 7, 26)).currentStreak).toBe(2)
  })

  it('breaks the current streak after a missed day, but keeps the longest streak on record', () => {
    recordPracticeDay(day(2026, 7, 20))
    recordPracticeDay(day(2026, 7, 21))
    recordPracticeDay(day(2026, 7, 22))
    // gap on the 23rd/24th/25th
    recordPracticeDay(day(2026, 7, 26))
    expect(getStreakStats(day(2026, 7, 26))).toEqual({
      currentStreak: 1,
      longestStreak: 3,
      totalDaysPracticed: 4,
    })
  })

  it('reads currentStreak as 0 once two full days have been missed', () => {
    recordPracticeDay(day(2026, 7, 20))
    // "now" is the 26th; last practice was 6 days ago -- long dead streak.
    expect(getStreakStats(day(2026, 7, 26)).currentStreak).toBe(0)
  })
})
