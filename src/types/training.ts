import type { HandMode } from './practice.ts'

export type TrainingHandMode = HandMode
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

/**
 * Which generator builds the exercise. This is a *setting*, not a
 * `PracticeSourceKind`: everything downstream of `Practice` (hidden virtual
 * keyboard, key-signature badge, "Next exercise", exercise history) wants the
 * same answers for a Hanon drill as for a generated one.
 */
export type ExerciseKind = 'generated' | 'hanon'

/** Play the exercise as printed, or stop at the turnaround for a shorter run. */
export type HanonLength = 'full' | 'ascending'

export interface HanonSettings {
  exerciseNumber: number
  handMode: TrainingHandMode
  /** A tonic name from musicKeys.ts's TRAINING_KEY_NAMES. Hanon is printed in C. */
  key: string
  /** Octaves to move the whole exercise by, to fit it on the keyboard. */
  octaveShift: number
  length: HanonLength
}

/** What `ExerciseSetup` hands back to App: the kind plus that kind's settings. */
export type ExerciseRequest =
  | { kind: 'generated'; settings: TrainingExerciseSettings }
  | { kind: 'hanon'; settings: HanonSettings }

/** What a generator hands back to App for one built exercise. */
export interface CreatedExercise {
  file: File
  keyName: string
  tonicPitchClass: number
  accidentalsLabel: string
}
