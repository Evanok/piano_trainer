export interface ExpectedEvent {
  index: number
  pitches: number[]
}

export type EventStatus = 'pending' | 'waiting' | 'error' | 'done'
