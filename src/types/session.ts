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
  /**
   * Free-play sessions still count as practice (the streak is recorded), but
   * their accuracy figures are meaningless -- nothing forced the player to get
   * a note right before moving on -- so End hides the grade for them.
   */
  practiceMode?: 'free' | 'wait'
  exercise?: ExerciseSessionStats
}
