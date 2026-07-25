import type { ExpectedEvent, EventStatus } from '../types/score'

const DEFAULT_CHORD_TOLERANCE_MS = 300

export interface WaitEngineState {
  currentIndex: number
  status: EventStatus
  completed: boolean
}

export type WaitEngineListener = (state: WaitEngineState) => void

/**
 * Core "Wait Mode" logic: blocks on the current expected note/chord until
 * all its pitches are played (in any order, within the chord tolerance
 * window), then advances. Wrong notes are reported but don't reset progress
 * already made on the current chord.
 */
export class WaitEngine {
  private events: ExpectedEvent[]
  private chordToleranceMs: number
  private currentIndex = 0
  private heldPitches = new Set<number>()
  private firstNoteTimestamp: number | null = null
  private listeners: WaitEngineListener[] = []

  constructor(events: ExpectedEvent[], chordToleranceMs = DEFAULT_CHORD_TOLERANCE_MS) {
    this.events = events
    this.chordToleranceMs = chordToleranceMs
  }

  get state(): WaitEngineState {
    return {
      currentIndex: this.currentIndex,
      status: this.currentIndex >= this.events.length ? 'done' : 'waiting',
      completed: this.currentIndex >= this.events.length,
    }
  }

  onChange(listener: WaitEngineListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private emit(status: EventStatus): void {
    const completed = this.currentIndex >= this.events.length
    for (const listener of this.listeners) {
      listener({ currentIndex: this.currentIndex, status, completed })
    }
  }

  noteOn(pitch: number, timestamp: number): EventStatus {
    if (this.currentIndex >= this.events.length) {
      return 'done'
    }

    const expected = this.events[this.currentIndex]

    if (!expected.pitches.includes(pitch)) {
      this.emit('error')
      return 'error'
    }

    if (this.heldPitches.size === 0) {
      this.firstNoteTimestamp = timestamp
    } else if (
      this.firstNoteTimestamp !== null &&
      timestamp - this.firstNoteTimestamp > this.chordToleranceMs
    ) {
      this.heldPitches.clear()
      this.firstNoteTimestamp = timestamp
    }

    this.heldPitches.add(pitch)

    const allCovered = expected.pitches.every((p) => this.heldPitches.has(p))
    if (!allCovered) {
      this.emit('waiting')
      return 'waiting'
    }

    this.currentIndex += 1
    this.heldPitches.clear()
    this.firstNoteTimestamp = null
    const status: EventStatus = this.currentIndex >= this.events.length ? 'done' : 'waiting'
    this.emit(status)
    return status
  }

  reset(): void {
    this.currentIndex = 0
    this.heldPitches.clear()
    this.firstNoteTimestamp = null
    this.emit('waiting')
  }
}
