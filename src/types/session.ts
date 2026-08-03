export interface ExerciseNoteStat {
  note: string
  count: number
}

export interface ExerciseConfusionStat {
  expected: string
  played: string
  count: number
}

export interface ExerciseSessionStats {
  responseCount: number
  averageResponseMs: number
  medianResponseMs: number
  slowestResponseMs: number
  missedNotes: ExerciseNoteStat[]
  wrongNotes: ExerciseNoteStat[]
  confusions: ExerciseConfusionStat[]
}

export interface SessionStats {
  durationMs: number
  errorCount: number
  totalEvents: number
  successPercent: number
  maxCombo: number
  exercise?: ExerciseSessionStats
}
