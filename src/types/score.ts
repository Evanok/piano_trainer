/**
 * Which hand a required note belongs to, when the score makes that knowable
 * (see selectHandStaves in ScoreParser: exactly two playable staves, top =
 * right, bottom = left). Null for every other layout -- a single-staff score,
 * an already hand-scoped generated exercise, an organ's three staves -- where
 * guessing would be worse than saying nothing.
 */
export type NoteHand = 'right' | 'left'

/**
 * A piano finger, as the score itself names it in
 * `<notations><technical><fingering>`: 1 is the thumb, 5 the little finger.
 * Only a plain 1..5 is read as one -- the corpus also carries circled digits,
 * parenthesised alternatives and free text ("etc."), whose conventions vary by
 * edition, and a wrong finger under a key is worse than no finger at all.
 */
export type NoteFinger = 1 | 2 | 3 | 4 | 5

export interface ExpectedEvent {
  index: number
  pitches: number[]
  measureNumber: number
  /**
   * Parallel to `pitches` (same length, same order), so a chord that doubles
   * one pitch in both hands keeps one entry per note rather than collapsing
   * into a pitch -> hand map that could only hold one answer. Optional so a
   * caller that has nothing to say about hands (a test fixture, any future
   * producer that is not the cursor walk) can leave it out entirely, which
   * reads the same as an array of nulls.
   */
  hands?: (NoteHand | null)[]
  /**
   * Parallel to `pitches` as well, for the same reason: the two notes of a
   * pitch doubled across the staves can name two different fingers. Most files
   * state no fingering at all, and most of those that do state it on only some
   * of their notes, so a null entry is the ordinary case rather than an error.
   */
  fingers?: (NoteFinger | null)[]
}

export type EventStatus = 'pending' | 'waiting' | 'error' | 'done'
