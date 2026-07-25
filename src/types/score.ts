export interface ExpectedEvent {
  index: number
  pitches: number[]
  measureNumber: number
}

export type EventStatus = 'pending' | 'waiting' | 'error' | 'done'
