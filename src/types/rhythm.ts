/**
 * The rhythm-reading drill ("where does this note fall in the measure"):
 * settings and questions.
 *
 * In `types/` for the same reason as the other drills' types: a round is
 * recorded as an ordinary session (`SessionSource`), and that type chain is
 * typechecked by the server too.
 */

/**
 * What a question asks, in this order: the beat the note falls in (1 to 4),
 * then where inside that beat (on it, "e", "and", "a"). Two steps rather than
 * sixteen buttons, which is also how the position is actually found: locate
 * the beat first, then subdivide it.
 */
export type RhythmAnswerStep = 'beat' | 'subdivision'

export const RHYTHM_ANSWER_STEPS: RhythmAnswerStep[] = ['beat', 'subdivision']

/** The four sixteenth positions of a beat, counted "1 e & a". */
export type RhythmSubdivision = 'beat' | 'e' | 'and' | 'a'

/**
 * The difficulty ladder. `eighths` uses quarters, eighths and the dotted
 * quarter, so a note is either on a beat or on its "and". `sixteenths` adds
 * the four-sixteenth groupings and the dotted eighth. `syncopated` adds rests
 * on the beat, notes held across a beat and off-beat sixteenths, so the beats
 * are no longer marked by the notes themselves and have to be counted.
 */
export type RhythmLevel = 'eighths' | 'sixteenths' | 'syncopated'

export interface RhythmQuizSettings {
  level: RhythmLevel
  questionCount: number
  /** Same round from the same seed, so a drill can be replayed exactly. */
  seed: string
}

export interface RhythmQuestion {
  /** 0-based position in the round. */
  index: number
  /** 1-based, and also which measure of the generated score draws it. */
  measureNumber: number
  /** The measure's notes and rests in sixteenths, a negative value being a rest. */
  durations: number[]
  /** Which entry of `durations` is the note asked about (never a rest). */
  targetIndex: number
  /** Where the target starts, in sixteenths from the barline (0 to 15). */
  onset: number
  /** 1 to 4. */
  beat: number
  subdivision: RhythmSubdivision
}
