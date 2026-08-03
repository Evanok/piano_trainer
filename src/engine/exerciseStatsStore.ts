import type { ExerciseSessionStats, SessionStats } from '../types/session'

const STORAGE_KEY = 'piano-trainer:exercise-sessions'
const MAX_STORED_SESSIONS = 100

export interface StoredExerciseSession {
  id: string
  completedAt: string
  scoreName: string
  durationMs: number
  errorCount: number
  totalEvents: number
  successPercent: number
  maxCombo: number
  exercise: ExerciseSessionStats
}

function readExerciseSessions(): StoredExerciseSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as StoredExerciseSession[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeExerciseSessions(sessions: StoredExerciseSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_STORED_SESSIONS)))
  } catch {
    // Storage unavailable -- exercise history just will not persist.
  }
}

export function getExerciseSessions(): StoredExerciseSession[] {
  return readExerciseSessions()
}

export function recordExerciseSession(scoreName: string, stats: SessionStats, now: Date = new Date()): void {
  if (!stats.exercise) {
    return
  }

  const completedAt = now.toISOString()
  const id = completedAt + ':' + scoreName
  const session: StoredExerciseSession = {
    id,
    completedAt,
    scoreName,
    durationMs: stats.durationMs,
    errorCount: stats.errorCount,
    totalEvents: stats.totalEvents,
    successPercent: stats.successPercent,
    maxCombo: stats.maxCombo,
    exercise: stats.exercise,
  }

  writeExerciseSessions([session, ...readExerciseSessions()])
}
