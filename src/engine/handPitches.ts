import type { ExpectedEvent, NoteFinger, NoteHand } from '../types/score'

/**
 * The pitches an event expects, split by the hand each note belongs to.
 * A pitch doubled in both hands (an octave-apart unison is not this, but the
 * same pitch written on both staves is) appears in both lists, which is what
 * lets the keyboard show one key as belonging to both hands.
 */
export interface HandPitches {
  right: number[]
  left: number[]
  /**
   * The finger the score names for each of those pitches, keyed by pitch and
   * holding only the ones the file actually states (see noteFinger). It rides
   * along with the hands rather than in a state of its own because both are
   * per-key annotations of the same current event, computed in one pass and
   * drawn by the same bar on the same key.
   */
  fingerByPitch: Record<number, NoteFinger>
}

export const NO_HAND_PITCHES: HandPitches = { right: [], left: [], fingerByPitch: {} }

/**
 * Both lists come back empty when the score has no unambiguous pair of hands
 * (every `hands` entry is null there), so a caller can pass the result on
 * unconditionally and the hand channel simply does not show. `fingerByPitch` is
 * independent of that: a single-staff score has no hands to report but can
 * still name its fingers, and a two-staff one can name its hands and no fingers.
 *
 * Two notes of the same pitch that name two DIFFERENT fingers cancel each other
 * out and the key shows none, since only one number fits under a key and
 * picking one of the two would be inventing an answer. One stated finger plus
 * one silent note is not a disagreement, so the stated one stands.
 */
export function handPitchesOf(event: ExpectedEvent | undefined): HandPitches {
  if (!event) {
    return NO_HAND_PITCHES
  }
  const byHand: { right: number[]; left: number[] } = { right: [], left: [] }
  const fingerByPitch: Record<number, NoteFinger> = {}
  const contradicted = new Set<number>()
  event.pitches.forEach((pitch, i) => {
    const hand: NoteHand | null = event.hands?.[i] ?? null
    if (hand && !byHand[hand].includes(pitch)) {
      byHand[hand].push(pitch)
    }
    const finger: NoteFinger | null = event.fingers?.[i] ?? null
    if (finger === null) {
      return
    }
    const known = fingerByPitch[pitch]
    if (known === undefined) {
      fingerByPitch[pitch] = finger
    } else if (known !== finger) {
      contradicted.add(pitch)
    }
  })
  contradicted.forEach((pitch) => {
    delete fingerByPitch[pitch]
  })
  return { ...byHand, fingerByPitch }
}
