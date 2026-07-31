export type TrainingHandMode = 'right' | 'left' | 'both'
export type TrainingAccidentalMode = 'none' | 'key' | 'chromatic'
export type TrainingDifficulty = 'easy' | 'medium' | 'hard'
export type TrainingExerciseContentMode = 'notes' | 'triads' | 'mixed'

export interface TrainingSettings {
  handMode: TrainingHandMode
  accidentalMode: TrainingAccidentalMode
  difficulty: TrainingDifficulty
  contentMode: TrainingExerciseContentMode
  // A KeyConfig.name from trainingGenerator.ts's KEYS, or 'random' to keep the
  // existing difficulty-scaled random pick.
  key: string
  measureCount: number
  rightOctaveLow: number
  rightOctaveHigh: number
  leftOctaveLow: number
  leftOctaveHigh: number
  seed: string
}

export type TrainingExerciseSettings = Omit<TrainingSettings, 'seed'>
