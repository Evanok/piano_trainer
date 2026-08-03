import type { ExpectedEvent, EventStatus } from '../types/score'

export const DEFAULT_CHORD_TOLERANCE_MS = 2000

/**
 * How far ahead free mode looks for the note it just heard, in measures.
 *
 * Deliberately measured in measures rather than events: a dense passage and a
 * sparse one hold very different numbers of notes, and what matters for
 * re-anchoring is musical distance, not note count. Small on purpose -- a wide
 * window lets a pitch that recurs later drag the cursor forward too early.
 */
export const DEFAULT_FOLLOW_WINDOW_MEASURES = 2

export type WaitEngineMode = 'wait' | 'free'

export interface WaitEngineState {
  currentIndex: number
  status: EventStatus
  completed: boolean
}

export type WaitEngineListener = (state: WaitEngineState) => void

/**
 * Core "Wait Mode" logic: blocks on the current expected note/chord until
 * all its pitches are held together, in any order. "Together" means within
 * chordToleranceMs of the first note of the attempt -- a correct note that
 * arrives too late doesn't stack with earlier ones, it starts a fresh
 * attempt on its own (the earlier notes expire). A wrong note resets the
 * attempt's held progress only if it arrives outside that same tolerance
 * window (a distinct, later attempt) -- a wrong note that lands within the
 * window (e.g. one finger slipping while pressing a chord with several
 * correct fingers at once) is reported as an error but doesn't erase the
 * correct notes already held in that same burst.
 */
export class WaitEngine {
  private events: ExpectedEvent[]
  private chordToleranceMs: number
  private followWindowMeasures: number
  private mode: WaitEngineMode = 'wait'
  private currentIndex = 0
  private heldPitches = new Set<number>()
  private firstHeldTimestamp: number | null = null
  private listeners: WaitEngineListener[] = []

  constructor(
    events: ExpectedEvent[],
    chordToleranceMs = DEFAULT_CHORD_TOLERANCE_MS,
    followWindowMeasures = DEFAULT_FOLLOW_WINDOW_MEASURES,
  ) {
    this.events = events
    this.chordToleranceMs = chordToleranceMs
    this.followWindowMeasures = followWindowMeasures
  }

  /**
   * Switching mode never moves the cursor -- the player stays exactly where
   * they were, only what happens on the next note changes.
   */
  setMode(mode: WaitEngineMode): void {
    this.mode = mode
    this.heldPitches.clear()
    this.firstHeldTimestamp = null
  }

  get state(): WaitEngineState {
    return {
      currentIndex: this.currentIndex,
      status: this.currentIndex >= this.events.length ? 'done' : 'waiting',
      completed: this.currentIndex >= this.events.length,
    }
  }

  get currentExpectedPitches(): number[] {
    return this.events[this.currentIndex]?.pitches ?? []
  }

  get currentHeldPitches(): number[] {
    return Array.from(this.heldPitches)
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

  /**
   * The nearest event at or ahead of the cursor (within the follow window)
   * that contains this pitch, or null if the note belongs to none of them.
   *
   * Nearest rather than best match on purpose: it is the conservative choice,
   * so a pitch that happens to recur later in the window can never pull the
   * cursor forward ahead of the player.
   */
  private findFollowMatch(pitch: number): number | null {
    const lastMeasure = this.events[this.currentIndex].measureNumber + this.followWindowMeasures
    for (let index = this.currentIndex; index < this.events.length; index += 1) {
      const event = this.events[index]
      if (event.measureNumber > lastMeasure) {
        break
      }
      if (event.pitches.includes(pitch)) {
        return index
      }
    }
    return null
  }

  noteOn(pitch: number, timestamp: number): EventStatus {
    if (this.currentIndex >= this.events.length) {
      return 'done'
    }

    if (this.mode === 'free') {
      const matchIndex = this.findFollowMatch(pitch)
      if (matchIndex === null) {
        // Nothing nearby expects this note. Report it, but never block on it
        // and never move -- in free mode a wrong note is just a wrong note.
        this.emit('error')
        return 'error'
      }
      if (matchIndex !== this.currentIndex) {
        // The player has moved past the cursor (a skipped note, an abandoned
        // chord, a flubbed bar). Re-anchor onto them rather than staying stuck
        // where they no longer are -- this is what keeps the scroll following
        // someone who plays on through their own mistakes.
        this.currentIndex = matchIndex
        this.heldPitches.clear()
        this.firstHeldTimestamp = null
      }
    }

    const expected = this.events[this.currentIndex]

    if (!expected.pitches.includes(pitch)) {
      const withinSameAttempt =
        this.firstHeldTimestamp !== null && timestamp - this.firstHeldTimestamp <= this.chordToleranceMs
      if (!withinSameAttempt) {
        this.heldPitches.clear()
        this.firstHeldTimestamp = null
      }
      this.emit('error')
      return 'error'
    }

    if (this.heldPitches.size === 0) {
      this.firstHeldTimestamp = timestamp
    } else if (
      this.firstHeldTimestamp !== null &&
      timestamp - this.firstHeldTimestamp > this.chordToleranceMs
    ) {
      // The earlier held notes arrived too long ago to count as the same
      // attempt -- they expire, and this note starts a fresh one.
      this.heldPitches.clear()
      this.firstHeldTimestamp = timestamp
    }

    this.heldPitches.add(pitch)

    const allCovered = expected.pitches.every((p) => this.heldPitches.has(p))
    if (!allCovered) {
      this.emit('waiting')
      return 'waiting'
    }

    this.currentIndex += 1
    this.heldPitches.clear()
    this.firstHeldTimestamp = null
    const status: EventStatus = this.currentIndex >= this.events.length ? 'done' : 'waiting'
    this.emit(status)
    return status
  }

  reset(): void {
    this.currentIndex = 0
    this.heldPitches.clear()
    this.firstHeldTimestamp = null
    this.emit('waiting')
  }

  /**
   * Actively clears held progress once the chord tolerance window has
   * elapsed with no new input (rather than waiting for noteOn's lazy check
   * on the next note), so the UI can visually decay back to neutral even
   * when the user simply pauses. Returns whether anything was cleared.
   */
  expireStaleHold(now: number): boolean {
    if (
      this.heldPitches.size > 0 &&
      this.firstHeldTimestamp !== null &&
      now - this.firstHeldTimestamp > this.chordToleranceMs
    ) {
      this.heldPitches.clear()
      this.firstHeldTimestamp = null
      this.emit('waiting')
      return true
    }
    return false
  }

  /** Index of the first event at or after the given 1-based measure number, or null if none exists. */
  findEventIndexForMeasure(measureNumber: number): number | null {
    const found = this.events.find((event) => event.measureNumber >= measureNumber)
    return found ? found.index : null
  }

  jumpToEventIndex(index: number): void {
    this.currentIndex = Math.max(0, Math.min(index, this.events.length))
    this.heldPitches.clear()
    this.firstHeldTimestamp = null
    this.emit(this.currentIndex >= this.events.length ? 'done' : 'waiting')
  }
}
