/**
 * The keyboard-free reading quiz: settings and questions.
 *
 * These live in `types/` rather than beside the generator because a quiz is
 * recorded as an ordinary session (`SessionSource`), and that type chain is
 * also typechecked by the server -- which must not end up pulling in a
 * generator that builds browser `File` objects.
 */

/** Which clef(s) the round draws from. */
export type ReadingClefMode = 'treble' | 'bass' | 'both'

/**
 * How far outside the staff notes are allowed to go, in ledger lines. One
 * ledger line is two diatonic positions (the line itself and the space next to
 * it), so this is the register ladder: 0 stays strictly between the staff
 * lines, 1 reaches middle C under the treble staff, and so on.
 */
export type ReadingLedgerLevel = 0 | 1 | 2 | 3

/**
 * How the note on screen is answered. `name` taps one of seven latin names;
 * `key` taps the note's own key on the piano keyboard, which trains the
 * association reading actually needs (note to key position, not note to
 * letter) and is the only one of the two that judges the octave.
 */
export type ReadingAnswerMode = 'name' | 'key'

export interface ReadingQuizSettings {
  answerMode: ReadingAnswerMode
  clefMode: ReadingClefMode
  ledgerLevel: ReadingLedgerLevel
  questionCount: number
  /** Same round from the same seed, so a drill can be replayed exactly. */
  seed: string
}

/** What a round asks, one per measure of the generated score. */
export interface ReadingQuestion {
  /** 0-based position in the round. */
  index: number
  /** 1-based, and also which measure of the generated score draws it. */
  measureNumber: number
  midi: number
  /** C, D, E, F, G, A or B. The quiz is diatonic: no accidentals, ever. */
  step: string
  octave: number
  clef: 'treble' | 'bass'
}
