export type TrainingHandMode = 'right' | 'left' | 'both'
export type TrainingAccidentalMode = 'none' | 'key' | 'chromatic'
export type TrainingDifficulty = 'easy' | 'medium' | 'hard'
export type TrainingExerciseContentMode = 'notes' | 'triads' | 'mixed'
export type TrainingTonality = 'major' | 'minor'

export interface TrainingSettings {
  handMode: TrainingHandMode
  accidentalMode: TrainingAccidentalMode
  difficulty: TrainingDifficulty
  contentMode: TrainingExerciseContentMode
  tonality: TrainingTonality
  // A tonic name from trainingGenerator.ts's TRAINING_KEY_NAMES, or 'random'.
  key: string
  measureCount: number
  rightOctaveLow: number
  rightOctaveHigh: number
  leftOctaveLow: number
  leftOctaveHigh: number
  seed: string
}

export type TrainingExerciseSettings = Omit<TrainingSettings, 'seed'>
