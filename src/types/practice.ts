export type PracticeSourceKind = 'score' | 'generated-training'
export type KeyboardAssistMode = 'none' | 'mistakes-only' | 'learning'

export interface PracticeBackingTrack {
  enabled: boolean
  keyName: string
  tonicPitchClass: number
}
