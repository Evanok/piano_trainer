import type { TempoStats } from '../types/session'

export type { TempoStats }

/**
 * Judges a played run against the clock, for the practice screen's tempo
 * mode: the score scrolls at a fixed tempo and every note has to land on its
 * time, instead of the score waiting for it (WaitEngine). Pure and DOM-free;
 * every time is a `performance.now()` millisecond, the same clock Web MIDI
 * stamps its messages with.
 *
 * Each expected note is a slot (an event's pitch). A key press takes the
 * nearest open slot of the same pitch within `GOOD_WINDOW_MS`; one that finds
 * none is a wrong note. An event is settled once every slot is taken, or once
 * its window has closed with a slot still open (missed). Only onsets are
 * judged: how long a note is held is not.
 */

/** At most this far from the beat counts as on time. */
export const ON_TIME_WINDOW_MS = 70
/** Beyond this a press is not matched to the note at all. */
export const GOOD_WINDOW_MS = 180

export type TempoResult = 'onTime' | 'early' | 'late' | 'missed'

export interface TempoEventInput {
  index: number
  pitches: number[]
  /** When the event falls, in performance.now() milliseconds. */
  timeMs: number
}

export interface SettledEvent {
  index: number
  result: TempoResult
  /** Mean offset of its played notes (negative = early), null when missed. */
  offsetMs: number | null
}

export type TempoNoteOutcome =
  | { kind: 'hit'; index: number; offsetMs: number; settled: SettledEvent | null }
  | { kind: 'wrong'; nearestIndex: number | null }

interface Slot {
  pitch: number
  offsetMs: number | null
}

interface EventState {
  input: TempoEventInput
  slots: Slot[]
  settled: SettledEvent | null
}

/** Classifies a mean offset; a press outside the window never gets here. */
export function classifyOffset(offsetMs: number): Exclude<TempoResult, 'missed'> {
  if (Math.abs(offsetMs) <= ON_TIME_WINDOW_MS) {
    return 'onTime'
  }
  return offsetMs < 0 ? 'early' : 'late'
}

export class TempoEngine {
  private readonly states: EventState[]
  /** Events before this are all settled, so the scans start here. */
  private firstOpen = 0

  constructor(events: TempoEventInput[]) {
    this.states = events.map((input) => ({
      input,
      slots: input.pitches.map((pitch) => ({ pitch, offsetMs: null })),
      settled: input.pitches.length === 0 ? { index: input.index, result: 'onTime', offsetMs: 0 } : null,
    }))
    this.skipSettled()
  }

  /** Index of the first event not settled yet, or null once all are. */
  get currentIndex(): number | null {
    return this.states[this.firstOpen]?.input.index ?? null
  }

  get isFinished(): boolean {
    return this.firstOpen >= this.states.length
  }

  /** Pitches of the first unsettled event, for the keyboard's highlight. */
  get currentPitches(): number[] {
    return this.states[this.firstOpen]?.input.pitches ?? []
  }

  noteOn(pitch: number, timeMs: number): TempoNoteOutcome {
    let best: { state: EventState; slot: Slot; offsetMs: number } | null = null
    for (let i = this.firstOpen; i < this.states.length; i += 1) {
      const state = this.states[i]
      const offsetMs = timeMs - state.input.timeMs
      if (offsetMs < -GOOD_WINDOW_MS) {
        break // Events are in time order: everything after is further away.
      }
      if (state.settled || offsetMs > GOOD_WINDOW_MS) {
        continue
      }
      const slot = state.slots.find((candidate) => candidate.pitch === pitch && candidate.offsetMs === null)
      if (slot && (!best || Math.abs(offsetMs) < Math.abs(best.offsetMs))) {
        best = { state, slot, offsetMs }
      }
    }

    if (!best) {
      return { kind: 'wrong', nearestIndex: this.nearestIndex(timeMs) }
    }

    best.slot.offsetMs = best.offsetMs
    let settled: SettledEvent | null = null
    if (best.state.slots.every((slot) => slot.offsetMs !== null)) {
      settled = this.settle(best.state)
    }
    return { kind: 'hit', index: best.state.input.index, offsetMs: best.offsetMs, settled }
  }

  /**
   * Settles, as missed, every event whose window has closed by `nowMs` with a
   * note still unplayed. Returns them in order.
   */
  advance(nowMs: number): SettledEvent[] {
    const missed: SettledEvent[] = []
    for (let i = this.firstOpen; i < this.states.length; i += 1) {
      const state = this.states[i]
      if (state.input.timeMs + GOOD_WINDOW_MS >= nowMs) {
        break
      }
      if (!state.settled) {
        state.settled = { index: state.input.index, result: 'missed', offsetMs: null }
        missed.push(state.settled)
      }
    }
    this.skipSettled()
    return missed
  }

  private settle(state: EventState): SettledEvent {
    const offsets = state.slots.map((slot) => slot.offsetMs ?? 0)
    const meanOffset = offsets.reduce((sum, value) => sum + value, 0) / offsets.length
    // A chord is on time only if every note of it is: one late finger is late.
    const worst = offsets.reduce((far, value) => (Math.abs(value) > Math.abs(far) ? value : far), 0)
    const result = classifyOffset(Math.abs(worst) > ON_TIME_WINDOW_MS ? worst : meanOffset)
    state.settled = { index: state.input.index, result, offsetMs: Math.round(meanOffset) }
    this.skipSettled()
    return state.settled
  }

  private skipSettled(): void {
    while (this.firstOpen < this.states.length && this.states[this.firstOpen].settled) {
      this.firstOpen += 1
    }
  }

  private nearestIndex(timeMs: number): number | null {
    let nearest: EventState | null = null
    for (const state of this.states) {
      if (!nearest || Math.abs(state.input.timeMs - timeMs) < Math.abs(nearest.input.timeMs - timeMs)) {
        nearest = state
      }
    }
    return nearest?.input.index ?? null
  }
}

export function emptyTempoStats(bpm: number): TempoStats {
  return { bpm, onTime: 0, early: 0, late: 0, missed: 0, meanOffsetMs: null }
}

/** Folds one settled event into the totals. */
export function addSettledEvent(stats: TempoStats, event: SettledEvent): TempoStats {
  const next = { ...stats, [event.result]: stats[event.result] + 1 }
  if (event.offsetMs !== null) {
    const played = stats.onTime + stats.early + stats.late
    const previousMean = stats.meanOffsetMs ?? 0
    next.meanOffsetMs = Math.round((previousMean * played + event.offsetMs) / (played + 1))
  }
  return next
}
