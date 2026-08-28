/**
 * Which hand a required note belongs to, when the score makes that knowable
 * (see selectHandStaves in ScoreParser: exactly two playable staves, top =
 * right, bottom = left). Null for every other layout -- a single-staff score,
 * an already hand-scoped generated exercise, an organ's three staves -- where
 * guessing would be worse than saying nothing.
 */
export type NoteHand = 'right' | 'left'

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
}

export type EventStatus = 'pending' | 'waiting' | 'error' | 'done'
