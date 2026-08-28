import type { ExpectedEvent, NoteHand } from '../types/score'

/**
 * The pitches an event expects, split by the hand each note belongs to.
 * A pitch doubled in both hands (an octave-apart unison is not this, but the
 * same pitch written on both staves is) appears in both lists, which is what
 * lets the keyboard show one key as belonging to both hands.
 */
export interface HandPitches {
  right: number[]
  left: number[]
}

export const NO_HAND_PITCHES: HandPitches = { right: [], left: [] }

/**
 * Both lists come back empty when the score has no unambiguous pair of hands
 * (every `hands` entry is null there), so a caller can pass the result on
 * unconditionally and the hand channel simply does not show.
 */
export function handPitchesOf(event: ExpectedEvent | undefined): HandPitches {
  if (!event) {
    return NO_HAND_PITCHES
  }
  const byHand: HandPitches = { right: [], left: [] }
  event.pitches.forEach((pitch, i) => {
    const hand: NoteHand | null = event.hands[i] ?? null
    if (hand && !byHand[hand].includes(pitch)) {
      byHand[hand].push(pitch)
    }
  })
  return byHand
}
