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

/** A time signature, e.g. 6/8 is `{ numerator: 6, denominator: 8 }`. */
export interface Meter {
  numerator: number
  denominator: number
}

/**
 * What the meter setting holds: follow the score's own time signature, no
 * accent at all, or a fixed signature written as "3/4".
 */
export type MeterChoice = 'score' | 'none' | `${number}/${number}`

/** The fixed signatures offered in the panel, besides the score's own. */
export const METER_CHOICES: readonly MeterChoice[] = ['2/4', '3/4', '4/4', '6/8']

/** The shares of the score's tempo offered as a starting speed. */
export const SCORE_TEMPO_PERCENTS: readonly number[] = [50, 60, 70, 80, 90, 100]
export const DEFAULT_SCORE_TEMPO_PERCENT = 100

export interface MetronomeSettings {
  bpm: number
  meter: MeterChoice
  /** 0..1 */
  volume: number
  /**
   * The share of the score's own tempo a piece starts at, when it states one.
   * Kept per device, so a player who works below tempo picks it once.
   */
  scorePercent: number
}

export const DEFAULT_METRONOME_SETTINGS: MetronomeSettings = {
  bpm: DEFAULT_BPM,
  meter: 'score',
  volume: 0.7,
  scorePercent: DEFAULT_SCORE_TEMPO_PERCENT,
}

/** Beat unit the bpm counts when there is no meter: quarter notes. */
const DEFAULT_COUNTED_UNIT = 4

/**
 * The score's tempo in the unit the bpm counts, which is the meter's bottom
 * number (eighths in 6/8, halves in 2/2), quarters without a meter. A 6/8
 * marked "dotted quarter = 60" is 90 quarters, so 180 here.
 */
export function scoreTempoInCountedUnit(quarterBpm: number, meter: Meter | null): number {
  return (quarterBpm * (meter?.denominator ?? DEFAULT_COUNTED_UNIT)) / 4
}

/** The bpm for a share of the score's tempo (already in the counted unit). */
export function bpmAtPercent(scoreBpm: number, percent: number): number {
  return clampBpm((scoreBpm * percent) / 100)
}

export type BeatAccent = 'strong' | 'medium' | 'weak'

export function formatMeter(meter: Meter): string {
  return `${meter.numerator}/${meter.denominator}`
}

export function parseMeter(text: string): Meter | null {
  const match = /^(\d+)\/(\d+)$/.exec(text)
  if (!match) {
    return null
  }
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  return numerator > 0 && denominator > 0 ? { numerator, denominator } : null
}

/**
 * The meter the metronome actually counts: the score's when the setting says
 * so (or holds something unreadable), none when the score states none.
 */
export function resolveMeter(choice: MeterChoice, scoreMeter: Meter | null): Meter | null {
  if (choice === 'none') {
    return null
  }
  if (choice === 'score') {
    return scoreMeter
  }
  return parseMeter(choice) ?? scoreMeter
}

/**
 * Compound meters (6/8, 9/8, 12/8) are counted in their eighths, with the
 * strong accent on the first and a lighter one at the start of every group of
 * three, which is how the bar is felt: 6/8 is ONE two three FOUR five six.
 */
export function isCompoundMeter(meter: Meter): boolean {
  return meter.denominator === 8 && meter.numerator >= 6 && meter.numerator % 3 === 0
}

/** One click per numerator unit; beat 0 of the bar is strong. */
export function beatAccent(beatIndex: number, meter: Meter | null): BeatAccent {
  if (!meter || meter.numerator < 2) {
    return 'strong'
  }
  const beatInBar = beatIndex % meter.numerator
  if (beatInBar === 0) {
    return 'strong'
  }
  if (isCompoundMeter(meter) && beatInBar % 3 === 0) {
    return 'medium'
  }
  return 'weak'
}

const SCHEDULER_INTERVAL_MS = 25
const LOOKAHEAD_SECONDS = 0.12
const START_LEAD_SECONDS = 0.05
const CLICK_SECONDS = 0.05
const CLICK_FREQUENCY: Record<BeatAccent, number> = { strong: 1760, medium: 1320, weak: 1100 }
const CLICK_LEVEL: Record<BeatAccent, number> = { strong: 1, medium: 0.8, weak: 0.6 }
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
  private silentFrom: number | null = null
  private silentUntil: number | null = null
  private pendingClicks = new Set<OscillatorNode>()
  private bpm: number
  private meter: Meter | null
  private volume: number

  /** Called as each beat sounds (not when it is scheduled). */
  onBeat: ((accent: BeatAccent) => void) | null = null

  constructor(bpm: number, meter: Meter | null, volume: number) {
    this.bpm = bpm
    this.meter = meter
    this.volume = volume
  }

  get isRunning(): boolean {
    return this.timerId !== null
  }

  update(bpm: number, meter: Meter | null, volume: number): void {
    // A tempo change applies from the next unscheduled beat, so the beat
    // already booked still sounds where it was promised.
    this.bpm = bpm
    this.meter = meter
    this.volume = volume
  }

  /**
   * Must be called from a user gesture (or after one already started the
   * audio): browsers only let an AudioContext start from one. Resolves false
   * when no audio is available.
   *
   * `anchorMs` puts a downbeat at that `performance.now()` time, so the clicks
   * share a grid with something else on that clock (the tempo mode's scroll);
   * a running metronome is restarted on the new grid. Without it, the first
   * click is right away. `silentFromMs` keeps the grid but mutes every click
   * from that time on (a count-in when the metronome itself is off).
   */
  async start(options: { anchorMs?: number; silentFromMs?: number | null } = {}): Promise<boolean> {
    if (this.isRunning) {
      if (options.anchorMs === undefined) {
        return true
      }
      this.stop()
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
    this.nextBeatTime =
      options.anchorMs === undefined ? context.currentTime + START_LEAD_SECONDS : this.contextTimeAt(options.anchorMs)
    this.silentFrom = options.silentFromMs == null ? null : this.contextTimeAt(options.silentFromMs)
    this.silentUntil = null
    this.timerId = setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS)
    this.schedule()
    return true
  }

  /**
   * Mutes (or, with null, unmutes) every click from that performance.now()
   * time on, or only up to `untilMs` when given: a loop pass is silent, and
   * the next pass's count-in after it is heard again.
   */
  setSilentFrom(perfMs: number | null, untilMs: number | null = null): void {
    this.silentFrom = perfMs === null ? null : this.contextTimeAt(perfMs)
    this.silentUntil = perfMs === null || untilMs === null ? null : this.contextTimeAt(untilMs)
  }

  /**
   * The audio-clock time at which a sound scheduled now is heard at
   * `perfMs`. getOutputTimestamp pairs the two clocks at the speaker, so the
   * output latency is already in it; the fallback subtracts the reported one.
   */
  private contextTimeAt(perfMs: number): number {
    const context = this.context
    if (!context) {
      return 0
    }
    const stamp = typeof context.getOutputTimestamp === 'function' ? context.getOutputTimestamp() : null
    if (stamp && stamp.contextTime !== undefined && stamp.performanceTime) {
      return stamp.contextTime + (perfMs - stamp.performanceTime) / 1000
    }
    const latency = context.outputLatency || context.baseLatency || 0
    return context.currentTime + (perfMs - performance.now()) / 1000 - latency
  }

  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId)
      this.timerId = null
    }
    // Clicks already booked inside the lookahead would otherwise still sound,
    // which on a restart on a new grid is a stray click off the beat.
    for (const oscillator of this.pendingClicks) {
      try {
        oscillator.stop()
      } catch {
        // Already finished.
      }
    }
    this.pendingClicks.clear()
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
    const interval = beatIntervalSeconds(this.bpm)
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
    const accent = beatAccent(beatIndex, this.meter)
    const peak = Math.max(0, Math.min(1, this.volume)) * MAX_CLICK_GAIN * CLICK_LEVEL[accent]

    const audible =
      this.silentFrom === null ||
      time < this.silentFrom - 0.001 ||
      (this.silentUntil !== null && time >= this.silentUntil - 0.001)
    if (!audible) {
      return // A muted beat neither sounds nor flashes.
    }
    if (peak > 0) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = CLICK_FREQUENCY[accent]
      const gain = context.createGain()
      gain.gain.setValueAtTime(0, time)
      gain.gain.linearRampToValueAtTime(peak, time + 0.002)
      gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_SECONDS)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(time)
      oscillator.stop(time + CLICK_SECONDS + 0.01)
      this.pendingClicks.add(oscillator)
      oscillator.onended = () => this.pendingClicks.delete(oscillator)
    }

    if (this.onBeat) {
      const delayMs = Math.max(0, (time - context.currentTime) * 1000)
      const timeout = setTimeout(() => {
        this.beatTimeouts.delete(timeout)
        this.onBeat?.(accent)
      }, delayMs)
      this.beatTimeouts.add(timeout)
    }
  }
}
