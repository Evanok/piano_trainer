export type PracticeSourceKind = 'score' | 'generated-training'
export type KeyboardAssistMode = 'none' | 'mistakes-only' | 'learning'

/**
 * Which hand(s) the player is required to play. Filters which notes under
 * the cursor are required to advance -- the other hand's notes (if any) are
 * simply not required, not hidden or blocked. Always defaults to 'both'.
 */
export type HandMode = 'right' | 'left' | 'both'

/**
 * What drives navigation through the piece:
 * - `page`: the whole piece, in the paginated layout, with NO wait-gating and
 *   no cursor/highlight at all -- the player just reads/plays through the
 *   printed score freely at their own pace, turning pages themselves. MIDI
 *   input is not tracked in this mode, so wrong-note stats are not collected
 *   for it -- a deliberate trade-off for a genuinely free read-along mode.
 * - `scroll`: the whole piece, wait-gated, in the scrolling layout.
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
