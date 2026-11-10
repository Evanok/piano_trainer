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
export type ExerciseKind = 'generated' | 'hanon' | 'ostinato'

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

/**
 * The left hand's repeated figure. Each one comes with its own chord
 * progression (see `ostinatoGenerator.ts`): `fifths` is a quarter-note pulse
 * (root, fifth, octave, fifth) for a first independence drill, `alberti` the
 * classical broken chord in eighths, `boogie` the walking blues bass in straight
 * eighths and `boogieDotted` the same in long-short pairs.
 */
export type OstinatoPattern = 'fifths' | 'alberti' | 'boogie' | 'boogieDotted'

/**
 * How busy the right hand's melody is, which is the actual independence
 * ladder. `easy` holds long notes (whole, half) over the moving bass, so the
 * left hand has to keep going under a note the right hand sustains. `medium`
 * moves in quarters and eighths. `hard` adds dotted rhythms, off-beat entries
 * and syncopations, so the two hands stop striking together.
 */
export type OstinatoMelodyRhythm = 'easy' | 'medium' | 'hard'

export interface OstinatoSettings {
  pattern: OstinatoPattern
  melodyRhythm: OstinatoMelodyRhythm
  /** A tonic name from musicKeys.ts's TRAINING_KEY_NAMES, or 'random'. Major keys only. */
  key: string
  measureCount: number
}

/** What `ExerciseSetup` hands back to App: the kind plus that kind's settings. */
export type ExerciseRequest =
  | { kind: 'generated'; settings: TrainingExerciseSettings }
  | { kind: 'hanon'; settings: HanonSettings }
  | { kind: 'ostinato'; settings: OstinatoSettings }

/** What a generator hands back to App for one built exercise. */
export interface CreatedExercise {
  file: File
  keyName: string
  tonicPitchClass: number
  accidentalsLabel: string
}
