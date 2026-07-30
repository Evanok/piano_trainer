export type TrainingHandMode = 'right' | 'left' | 'both'
export type TrainingAccidentalMode = 'none' | 'key' | 'chromatic'
export type TrainingDifficulty = 'easy' | 'medium' | 'hard'

export interface TrainingSettings {
  handMode: TrainingHandMode
  accidentalMode: TrainingAccidentalMode
  difficulty: TrainingDifficulty
  measureCount: number
  rightOctaveLow: number
  rightOctaveHigh: number
  leftOctaveLow: number
  leftOctaveHigh: number
  seed: string
}

export type TrainingExerciseSettings = Omit<TrainingSettings, 'seed'>
