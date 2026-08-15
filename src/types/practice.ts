export type PracticeSourceKind = 'score' | 'generated-training'
export type KeyboardAssistMode = 'none' | 'mistakes-only' | 'learning'

/**
 * What drives navigation through the piece:
 * - `page`/`scroll`: the whole piece, wait-gated, in the matching PianoScore layout.
 * - `sectionFree`: section-by-section, wait-gated, but never rewinds on error --
 *   always advances once the section's last note is played.
 * - `sectionTraining`: section-by-section, rewinds to the start of the same
 *   section if it was completed with any error; a clean pass advances it.
 */
export type PracticeMode = 'page' | 'scroll' | 'sectionFree' | 'sectionTraining'

export interface PracticeBackingTrack {
  enabled: boolean
  keyName: string
  tonicPitchClass: number
}

export interface PracticeKeySignature {
  keyName: string
  accidentalsLabel: string
}
