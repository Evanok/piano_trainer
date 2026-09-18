/**
 * The chord-reading drill: a triad drawn on a staff, named with a handful of
 * quality buttons.
 *
 * Like the reading quiz's own types, these live in `types/` rather than beside
 * the generator because a round is recorded as an ordinary session
 * (`SessionSource`), and that type chain is typechecked by the server too --
 * which must not end up pulling in a generator that builds browser `File`
 * objects.
 */

/**
 * The four qualities a triad can have. All four are named because that is what
 * a triad is, but a round only ever asks for the ones its material actually
 * contains (`ChordRound.qualities` drives the buttons): the diatonic triads of
 * a major key are major, minor and diminished, and an augmented one cannot
 * appear among them at all.
 */
export type ChordQuality = 'major' | 'minor' | 'diminished' | 'augmented'

/**
 * Which clef the round is drawn in. One at a time, deliberately: mixing them
 * adds "which clef is this" on top of "which chord is this", and the drill is
 * about the second. Reading chords in the bass clef is its own exercise, which
 * is why the choice exists at all.
 */
export type ChordClefMode = 'treble' | 'bass'

/**
 * What the round asks for.
 *
 * `chord` names the chord itself -- one tap among the seven note names, since
 * in do major the root decides the quality, so "sol" IS "sol major". That is
 * the operation actually performed when reading a piece written on chords, and
 * it is the mode this drill exists for.
 *
 * `quality` asks only whether the stack is major, minor or diminished. Fewer
 * buttons and a different question: it drills the quality column of the table
 * without requiring the bottom note to be read precisely.
 */
export type ChordAnswerMode = 'chord' | 'quality'

/**
 * Which position the triad is stacked in. 0 is root position, 1 and 2 are the
 * first and second inversions.
 */
export type ChordInversion = 0 | 1 | 2

/**
 * Whether a round inverts its chords.
 *
 * This is the setting that decides whether the drill asks anything at all in
 * `chord` answer mode. In root position the bottom note *is* the root, so
 * naming the chord is naming the bottom note -- the reading quiz with two extra
 * notes drawn on top. Inverted, the root is somewhere else in the stack and has
 * to be found, which is both a real question and the thing that actually blocks
 * reading chords in real music.
 *
 * `all` mixes the three positions rather than only inverting, because
 * recognising that a stack *is* in root position is part of the same skill.
 */
export type ChordStackMode = 'root' | 'all'

/**
 * Whether the round may write sharps and flats.
 *
 * `none` keeps the seven diatonic triads of do major -- one chord per letter,
 * so the quality follows from the letter and can be recited from a table.
 * `all` frees the two apart: sol major AND sol minor can both come up, so the
 * quality has to be actually measured (the gap between the bottom two notes,
 * four semitones or three) instead of recalled. That measurement is the only
 * method that survives a change of key, which is the whole reason this axis
 * exists.
 */
export type ChordAccidentalMode = 'none' | 'all'

export interface ChordQuizSettings {
  answerMode: ChordAnswerMode
  accidentalMode: ChordAccidentalMode
  stackMode: ChordStackMode
  clefMode: ChordClefMode
  questionCount: number
  /** Same round from the same seed, so a drill can be replayed exactly. */
  seed: string
}

/** One note of a drawn chord. Plain fields, so this file pulls in no engine. */
export interface ChordNote {
  midi: number
  /** C, D, E, F, G, A or B -- the letter, which is the staff position. */
  step: string
  /** -1 flat, 0 natural, +1 sharp. The letter alone does not say the pitch. */
  alter: number
  octave: number
}

/** One question: a triad to name, and everything needed to draw and judge it. */
export interface ChordQuestion {
  /** 0-based position in the round. */
  index: number
  /** 1-based, and also which measure of the generated score draws it. */
  measureNumber: number
  /**
   * The root's letter name.
   *
   * Named `step` because that is the field `NamingQuizEngine` judges, so the
   * inherited "name the note" answer needs no chord-specific code at all: it
   * IS the `chord` answer mode.
   */
  step: string
  /** The root's own accidental: -1 flat, 0 natural, +1 sharp. */
  rootAlter: number
  /** Bottom to top, always three notes. */
  notes: ChordNote[]
  quality: ChordQuality
  /**
   * 'I', 'ii', 'vii°' ... -- shown as feedback, not asked for, and **null for
   * any chord that is not one of do major's own seven**. A degree names a
   * chord's place in a key, so sol minor has none here: printing one would be
   * inventing a key the round is not in.
   */
  degree: string | null
  /**
   * Which position the drawn stack is in. Not asked for either: naming the
   * right root on an inverted chord already proves the inversion was resolved,
   * so a separate question would cost a tap and measure nothing. It is shown in
   * the reveal, and it is what a per-inversion accuracy split would read.
   */
  inversion: ChordInversion
}
