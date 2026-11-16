/**
 * A Web Audio metronome for the practice screen. Independent of Wait Mode: it
 * just ticks at a chosen tempo while the player works, the score never waits
 * on it and nothing is judged against it.
 *
 * Clicks are scheduled on the audio clock, not fired from timers: a
 * setInterval only *looks ahead* (`LOOKAHEAD_SECONDS`) and books every beat
 * that falls inside that window at its exact `AudioContext` time. A timer-fired
 * click would drift and stutter with every main-thread hiccup, which on this
 * screen (OSMD renders, note coloring) is constant. The cost is that a freeze
 * longer than the lookahead (a mode switch on a phone) drops the beats it
 * covers; the metronome then resumes on the grid rather than bursting the
 * missed clicks out all at once.
 */

export const MIN_BPM = 30
export const MAX_BPM = 240
export const DEFAULT_BPM = 80

/** 0 means no accent: every beat clicks the same. */
export const BEATS_PER_BAR_CHOICES = [0, 2, 3, 4, 6] as const

export interface MetronomeSettings {
  bpm: number
  /** Accented beat every N beats, 0 for no accent. */
  beatsPerBar: number
  /** 0..1 */
  volume: number
}

export const DEFAULT_METRONOME_SETTINGS: MetronomeSettings = {
  bpm: DEFAULT_BPM,
  beatsPerBar: 4,
  volume: 0.7,
}

const SCHEDULER_INTERVAL_MS = 25
const LOOKAHEAD_SECONDS = 0.12
const START_LEAD_SECONDS = 0.05
const CLICK_SECONDS = 0.05
const ACCENT_FREQUENCY = 1760
const BEAT_FREQUENCY = 1100
const MAX_CLICK_GAIN = 0.9

/** Taps further apart than this start a new measurement. */
export const TAP_RESET_MS = 2000
const TAP_HISTORY = 6

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) {
    return DEFAULT_BPM
  }
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)))
}

export function beatIntervalSeconds(bpm: number): number {
  return 60 / clampBpm(bpm)
}

/** Beat 0 of every bar is accented; with no bar length nothing is. */
export function isAccentBeat(beatIndex: number, beatsPerBar: number): boolean {
  return beatsPerBar > 1 && beatIndex % beatsPerBar === 0
}

/**
 * Keeps only the taps that belong to the current measurement: the most recent
 * run whose gaps are all under `TAP_RESET_MS`, capped at the last few taps so
 * a tempo change while tapping is followed quickly.
 */
export function recentTaps(taps: readonly number[]): number[] {
  let start = taps.length - 1
  while (start > 0 && taps[start] - taps[start - 1] < TAP_RESET_MS) {
    start -= 1
  }
  return taps.slice(Math.max(start, taps.length - TAP_HISTORY))
}

/** Tempo from tap timestamps (ms), or null until there are two taps. */
export function tapTempoBpm(taps: readonly number[]): number | null {
  const run = recentTaps(taps)
  if (run.length < 2) {
    return null
  }
  const averageGapMs = (run[run.length - 1] - run[0]) / (run.length - 1)
  return averageGapMs > 0 ? clampBpm(60000 / averageGapMs) : null
}

interface WebkitAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null
  }
  const AudioContextCtor = window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext
  return AudioContextCtor ? new AudioContextCtor() : null
}

export class Metronome {
  private context: AudioContext | null = null
  private timerId: ReturnType<typeof setInterval> | null = null
  private beatTimeouts = new Set<ReturnType<typeof setTimeout>>()
  private nextBeatTime = 0
  private beatIndex = 0
  private settings: MetronomeSettings

  /** Called as each beat sounds (not when it is scheduled), with its index in the bar. */
  onBeat: ((beatInBar: number, accent: boolean) => void) | null = null

  constructor(settings: MetronomeSettings) {
    this.settings = { ...settings }
  }

  get isRunning(): boolean {
    return this.timerId !== null
  }

  update(settings: MetronomeSettings): void {
    // A tempo change applies from the next unscheduled beat, so the beat
    // already booked still sounds where it was promised.
    this.settings = { ...settings }
  }

  /**
   * Must be called from a user gesture: browsers only let an AudioContext
   * start (or resume) from one. Resolves false when no audio is available.
   */
  async start(): Promise<boolean> {
    if (this.isRunning) {
      return true
    }
    if (!this.context) {
      this.context = createAudioContext()
    }
    const context = this.context
    if (!context) {
      return false
    }
    try {
      await context.resume()
    } catch {
      return false
    }
    this.beatIndex = 0
    this.nextBeatTime = context.currentTime + START_LEAD_SECONDS
    this.timerId = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS)
    this.schedule()
    return true
  }

  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    for (const timeout of this.beatTimeouts) {
      clearTimeout(timeout)
    }
    this.beatTimeouts.clear()
  }

  /** Stops and releases the audio context. The instance can be started again. */
  dispose(): void {
    this.stop()
    const context = this.context
    this.context = null
    if (context) {
      void context.close().catch(() => undefined)
    }
  }

  private schedule(): void {
    const context = this.context
    if (!context) {
      return
    }
    const interval = beatIntervalSeconds(this.settings.bpm)
    // Back on the grid after a freeze: skip the beats that are already past
    // instead of playing them all at once.
    if (this.nextBeatTime < context.currentTime) {
      const missed = Math.ceil((context.currentTime - this.nextBeatTime) / interval)
      this.nextBeatTime += missed * interval
      this.beatIndex += missed
    }
    while (this.nextBeatTime < context.currentTime + LOOKAHEAD_SECONDS) {
      this.scheduleClick(context, this.nextBeatTime, this.beatIndex)
      this.nextBeatTime += interval
      this.beatIndex += 1
    }
  }

  private scheduleClick(context: AudioContext, time: number, beatIndex: number): void {
    const { beatsPerBar, volume } = this.settings
    const accent = isAccentBeat(beatIndex, beatsPerBar)
    const peak = Math.max(0, Math.min(1, volume)) * MAX_CLICK_GAIN * (accent || beatsPerBar <= 1 ? 1 : 0.6)

    if (peak > 0) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = accent ? ACCENT_FREQUENCY : BEAT_FREQUENCY
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, time)
      gain.gain.linearRampToValueAtTime(peak, time + 0.002)
      gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_SECONDS)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(time)
      oscillator.stop(time + CLICK_SECONDS + 0.01)
    }

    if (this.onBeat) {
      const beatInBar = beatsPerBar > 1 ? beatIndex % beatsPerBar : 0
      const delayMs = Math.max(0, (time - context.currentTime) * 1000)
      const timeout = setTimeout(() => {
        this.beatTimeouts.delete(timeout)
        this.onBeat?.(beatInBar, accent)
      }, delayMs)
      this.beatTimeouts.add(timeout)
    }
  }
}
