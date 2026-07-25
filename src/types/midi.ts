export type MidiNoteEventType = 'noteon' | 'noteoff'

export interface MidiNoteEvent {
  pitch: number
  velocity: number
  timestamp: number
  type: MidiNoteEventType
}

export interface MidiDeviceInfo {
  id: string
  name: string
}
