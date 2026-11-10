/**
 * The interval-reading drill: settings and questions.
 *
 * In `types/` for the same reason as the other drills' types: a round is
 * recorded as an ordinary session (`SessionSource`), and that type chain is
 * typechecked by the server too, which must not pull in a generator that
 * builds browser `File` objects.
 */

/**
 * What a question asks, in this order. The number (a third, a fifth) is read
 * straight off the staff by counting letters; the quality (major, minor,
 * perfect...) is measured in semitones and can only be measured once the number
 * is known. Asking them apart, like the chord drill's root and quality, is what
 * tells which of the two was missed.
 */
export type IntervalAnswerStep = 'number' | 'quality'

export const INTERVAL_ANSWER_STEPS: IntervalAnswerStep[] = ['number', 'quality']

/**
 * `harmonic` stacks the two notes (struck together, as in a chord), `melodic`
 * draws them one after the other, going up or down. `mixed` draws either.
 */
export type IntervalLayout = 'harmonic' | 'melodic' | 'mixed'

/**
 * `none` keeps both notes natural, which already produces every common quality
 * (fa-si is the augmented fourth, si-fa the diminished fifth). `all` lets one of
 * the two notes carry a sharp or a flat, so a third can no longer be judged by
 * remembering which letter pairs are major: it has to be measured.
 */
export type IntervalAccidentalMode = 'none' | 'all'

export type IntervalClefMode = 'treble' | 'bass' | 'both'

/** The widest interval a round asks: up to a fifth first, then up to the octave. */
export type IntervalMaxNumber = 5 | 8

export type IntervalQuality = 'diminished' | 'minor' | 'perfect' | 'major' | 'augmented'

export interface IntervalQuizSettings {
  answerSteps: IntervalAnswerStep[]
  layout: IntervalLayout
  accidentalMode: IntervalAccidentalMode
  clefMode: IntervalClefMode
  maxNumber: IntervalMaxNumber
  questionCount: number
  /** Same round from the same seed, so a drill can be replayed exactly. */
  seed: string
}

export interface IntervalNote {
  midi: number
  /** C..B */
  step: string
  /** -1 flat, 0 natural, 1 sharp. */
  alter: number
  octave: number
}

export interface IntervalQuestion {
  /** 0-based position in the round. */
  index: number
  /** 1-based, and also which measure of the generated score draws it. */
  measureNumber: number
  clef: 'treble' | 'bass'
  lower: IntervalNote
  upper: IntervalNote
  /** 2 (second) to 8 (octave): letters counted inclusively. */
  number: number
  quality: IntervalQuality
  semitones: number
  /** Drawn one note after the other rather than stacked. */
  melodic: boolean
  /** Melodic only: the upper note is played first. */
  descending: boolean
}
