/**
 * The note-order drill: walk do re mi fa sol la si do in either direction, with
 * no staff, no MIDI and no piano.
 *
 * It exists because the sequence is only ever learned forwards. Going down from
 * a note that is not do means either knowing the order backwards or silently
 * reciting it from the start, and the second is what makes sight-reading slow.
 *
 * These live in `types/` rather than beside the generator for the same reason
 * the reading quiz's settings do: a round is recorded as an ordinary session,
 * and the `SessionSource` type chain is typechecked by the server too, which
 * must not end up pulling in a generator that builds browser `File` objects.
 */

/** Which way the drill walks. 'mixed' rerolls per question. */
export type NoteSequenceDirection = 'up' | 'down' | 'mixed'

/**
 * How far each step goes. 'second' is the neighbouring note (do to re), 'third'
 * skips one (do to mi), which is the shape chords are read in. 'mixed' rerolls
 * per question.
 */
export type NoteSequenceDistance = 'second' | 'third' | 'mixed'

export interface NoteSequenceSettings {
  direction: NoteSequenceDirection
  distance: NoteSequenceDistance
  questionCount: number
  /** Same round from the same seed, so a drill can be replayed exactly. */
  seed: string
}

/** One question: a note, a direction, and the note that answers it. */
export interface NoteSequenceQuestion {
  /** 0-based position in the round. */
  index: number
  /** The note shown on screen. Letter names, as everywhere else in the app. */
  from: string
  direction: 'up' | 'down'
  /** In diatonic steps: 1 is the next note, 2 skips one. */
  distance: 1 | 2
  /**
   * The answer. Named `step` rather than `to` so `NamingQuizEngine` judges it
   * with no special case: every quiz question in the app answers with a note
   * name, and that is the field the engine reads.
   */
  step: string
}
