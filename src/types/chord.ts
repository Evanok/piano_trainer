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

export interface ChordQuizSettings {
  clefMode: ChordClefMode
  questionCount: number
  /** Same round from the same seed, so a drill can be replayed exactly. */
  seed: string
}

/** One note of a drawn chord. Plain fields, so this file pulls in no engine. */
export interface ChordNote {
  midi: number
  /** C, D, E, F, G, A or B. This drill is natural notes only, in C major. */
  step: string
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
   * inherited "name the note" answer already asks for the root -- which is
   * exactly the next rung of this drill's ladder (see IDEA.md). Nothing calls
   * it yet: at this level the chords are never inverted, so the root is simply
   * the bottom note and asking for it would be the reading quiz with two extra
   * notes drawn on top.
   */
  step: string
  /** Bottom to top, always three notes, always root position. */
  notes: ChordNote[]
  quality: ChordQuality
  /** 'I', 'ii', 'vii°' ... -- shown as feedback, not asked for. */
  degree: string
}
