export type PracticeSourceKind = 'score' | 'generated-training'
export type KeyboardAssistMode = 'none' | 'mistakes-only' | 'learning'

/**
 * What drives the cursor through the piece.
 *
 * - `wait`: the score gates the player -- nothing advances until the expected
 *   note/chord is played (the founding Wait Mode).
 * - `drill`: `wait` plus section-by-section repetition, gated on perfect runs.
 * - `free`: the score *follows* the player instead of gating them. A wrong note
 *   never blocks, and the cursor re-anchors on wherever the player actually is
 *   (see WaitEngine's follow window), so playing a piece straight through with
 *   mistakes still keeps the right measures on screen.
 *
 * `drill` is a variant of `wait`, not a peer, but the three are one enum
 * because they map 1:1 onto the mode selector and only one can be active.
 */
export type PracticeMode = 'free' | 'wait' | 'drill'

export interface PracticeBackingTrack {
  enabled: boolean
  keyName: string
  tonicPitchClass: number
}

export interface PracticeKeySignature {
  keyName: string
  accidentalsLabel: string
}
