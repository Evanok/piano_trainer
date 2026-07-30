import { beforeEach, describe, expect, it } from "vitest"
import { getExerciseSessions, recordExerciseSession } from "./exerciseStatsStore"

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

const exerciseStats = {
  responseCount: 2,
  averageResponseMs: 500,
  medianResponseMs: 450,
  slowestResponseMs: 800,
  missedNotes: [{ note: "C4", count: 1 }],
  wrongNotes: [{ note: "D4", count: 1 }],
  confusions: [{ expected: "C4", played: "D4", count: 1 }],
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

describe("exerciseStatsStore", () => {
  it("ignores regular sessions without exercise stats", () => {
    recordExerciseSession("score.musicxml", {
      durationMs: 1000,
      errorCount: 0,
      totalEvents: 4,
      successPercent: 100,
      maxCombo: 4,
    })

    expect(getExerciseSessions()).toEqual([])
  })

  it("stores exercise sessions newest first", () => {
    recordExerciseSession(
      "first.musicxml",
      {
        durationMs: 1000,
        errorCount: 1,
        totalEvents: 4,
        successPercent: 75,
        maxCombo: 3,
        exercise: exerciseStats,
      },
      new Date(2026, 6, 1, 10),
    )
    recordExerciseSession(
      "second.musicxml",
      {
        durationMs: 2000,
        errorCount: 0,
        totalEvents: 8,
        successPercent: 100,
        maxCombo: 8,
        exercise: { ...exerciseStats, responseCount: 8 },
      },
      new Date(2026, 6, 1, 11),
    )

    const sessions = getExerciseSessions()
    expect(sessions.map((session) => session.scoreName)).toEqual(["second.musicxml", "first.musicxml"])
    expect(sessions[0].exercise.responseCount).toBe(8)
  })

  it("keeps only the latest 100 sessions", () => {
    for (let i = 0; i < 105; i += 1) {
      recordExerciseSession(
        "exercise-" + i + ".musicxml",
        {
          durationMs: 1000,
          errorCount: 0,
          totalEvents: 4,
          successPercent: 100,
          maxCombo: 4,
          exercise: exerciseStats,
        },
        new Date(2026, 6, 1, 10, i),
      )
    }

    const sessions = getExerciseSessions()
    expect(sessions).toHaveLength(100)
    expect(sessions[0].scoreName).toBe("exercise-104.musicxml")
    expect(sessions[99].scoreName).toBe("exercise-5.musicxml")
  })
})
