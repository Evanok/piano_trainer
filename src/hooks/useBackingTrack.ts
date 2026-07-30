import { useCallback, useEffect, useRef, useState } from 'react'
import { BACKING_TRACK_BPM, BEATS_PER_BAR, buildBassProgression, midiToFrequency } from '../engine/backingTrack'
import type { PracticeBackingTrack } from '../types/practice'

// Standard Web Audio lookahead scheduling (Chris Wilson's "A Tale of Two
// Clocks"): a cheap interval polls frequently and only schedules audio events
// that fall inside a short lookahead window, so actual playback timing comes
// from the audio clock, not from setInterval's own jitter.
const SCHEDULER_INTERVAL_MS = 25
const SCHEDULE_AHEAD_SEC = 0.1
const SECONDS_PER_BEAT = 60 / BACKING_TRACK_BPM

interface ActiveTrack {
  context: AudioContext
  masterGain: GainNode
  noiseBuffer: AudioBuffer
  bassProgression: number[]
  nextNoteTime: number
  beatInBar: number
  barIndex: number
  timerId: number
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

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.round(context.sampleRate * 0.3)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1
  }
  return buffer
}

function scheduleKick(context: AudioContext, destination: AudioNode, time: number): void {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(150, time)
  oscillator.frequency.exponentialRampToValueAtTime(40, time + 0.12)
  gain.gain.setValueAtTime(0.9, time)
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16)
  oscillator.connect(gain)
  gain.connect(destination)
  oscillator.start(time)
  oscillator.stop(time + 0.18)
}

function scheduleNoiseHit(
  context: AudioContext,
  noiseBuffer: AudioBuffer,
  destination: AudioNode,
  time: number,
  options: { filterType: BiquadFilterType; filterFrequency: number; duration: number; gainLevel: number },
): void {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer
  const filter = context.createBiquadFilter()
  filter.type = options.filterType
  filter.frequency.setValueAtTime(options.filterFrequency, time)
  const gain = context.createGain()
  gain.gain.setValueAtTime(options.gainLevel, time)
  gain.gain.exponentialRampToValueAtTime(0.001, time + options.duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(destination)
  source.start(time)
  source.stop(time + options.duration + 0.02)
}

function scheduleHihat(context: AudioContext, noiseBuffer: AudioBuffer, destination: AudioNode, time: number): void {
  scheduleNoiseHit(context, noiseBuffer, destination, time, {
    filterType: 'highpass',
    filterFrequency: 8000,
    duration: 0.05,
    gainLevel: 0.18,
  })
}

function scheduleSnare(context: AudioContext, noiseBuffer: AudioBuffer, destination: AudioNode, time: number): void {
  scheduleNoiseHit(context, noiseBuffer, destination, time, {
    filterType: 'bandpass',
    filterFrequency: 1800,
    duration: 0.14,
    gainLevel: 0.32,
  })
}

function scheduleBassNote(
  context: AudioContext,
  destination: AudioNode,
  midi: number,
  time: number,
  duration: number,
): void {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sawtooth'
  oscillator.frequency.setValueAtTime(midiToFrequency(midi), time)
  gain.gain.setValueAtTime(0, time)
  gain.gain.linearRampToValueAtTime(0.5, time + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
  oscillator.connect(gain)
  gain.connect(destination)
  oscillator.start(time)
  oscillator.stop(time + duration + 0.02)
}

function scheduleBeat(active: ActiveTrack, time: number): void {
  const { context, masterGain, noiseBuffer, bassProgression, beatInBar, barIndex } = active
  // Basic kick/snare/hihat pop-rock beat: kick on 1 & 3, snare (backbeat) on
  // 2 & 4, hihat pulsing every beat.
  if (beatInBar === 0 || beatInBar === 2) {
    scheduleKick(context, masterGain, time)
    const midi = bassProgression[barIndex % bassProgression.length]
    scheduleBassNote(context, masterGain, midi, time, SECONDS_PER_BEAT * 1.8)
  }
  if (beatInBar === 1 || beatInBar === 3) {
    scheduleSnare(context, noiseBuffer, masterGain, time)
  }
  scheduleHihat(context, noiseBuffer, masterGain, time)
}

function tick(active: ActiveTrack): void {
  while (active.nextNoteTime < active.context.currentTime + SCHEDULE_AHEAD_SEC) {
    scheduleBeat(active, active.nextNoteTime)
    active.nextNoteTime += SECONDS_PER_BEAT
    active.beatInBar += 1
    if (active.beatInBar >= BEATS_PER_BAR) {
      active.beatInBar = 0
      active.barIndex += 1
    }
  }
}

// Only called once the AudioContext is confirmed running: starting the
// interval while still suspended would freeze nextNoteTime at creation time,
// so the first tick after a delayed user-gesture resume would see a huge gap
// to "catch up" and fire a burst of overdue beats all at once.
function beginScheduling(active: ActiveTrack): void {
  if (active.timerId !== 0) {
    return
  }
  active.nextNoteTime = active.context.currentTime + 0.1
  active.beatInBar = 0
  active.barIndex = 0
  active.timerId = window.setInterval(() => tick(active), SCHEDULER_INTERVAL_MS)
  tick(active)
}

function stopActiveTrack(active: ActiveTrack): void {
  if (active.timerId !== 0) {
    window.clearInterval(active.timerId)
  }
  const now = active.context.currentTime
  active.masterGain.gain.cancelScheduledValues(now)
  active.masterGain.gain.setTargetAtTime(0, now, 0.08)
  window.setTimeout(() => {
    void active.context.close()
  }, 500)
}

export function useBackingTrack(backingTrack: PracticeBackingTrack | null) {
  const activeRef = useRef<ActiveTrack | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [needsUserStart, setNeedsUserStart] = useState(false)
  const isEnabled = backingTrack?.enabled === true

  const stop = useCallback(() => {
    const active = activeRef.current
    if (!active) {
      return
    }
    activeRef.current = null
    stopActiveTrack(active)
    setIsRunning(false)
    setNeedsUserStart(false)
  }, [])

  const start = useCallback(async () => {
    if (!backingTrack?.enabled) {
      return
    }

    if (activeRef.current) {
      const active = activeRef.current
      try {
        await active.context.resume()
      } catch {
        setNeedsUserStart(true)
        return
      }
      const running = active.context.state === 'running'
      if (running) {
        beginScheduling(active)
      }
      setIsRunning(running)
      setNeedsUserStart(!running)
      return
    }

    const context = createAudioContext()
    if (!context) {
      setNeedsUserStart(false)
      return
    }

    const masterGain = context.createGain()
    masterGain.gain.setValueAtTime(0, context.currentTime)
    masterGain.gain.linearRampToValueAtTime(0.8, context.currentTime + 0.3)
    const compressor = context.createDynamicsCompressor()
    masterGain.connect(compressor)
    compressor.connect(context.destination)

    const active: ActiveTrack = {
      context,
      masterGain,
      noiseBuffer: createNoiseBuffer(context),
      bassProgression: buildBassProgression(backingTrack.tonicPitchClass),
      nextNoteTime: 0,
      beatInBar: 0,
      barIndex: 0,
      timerId: 0,
    }
    activeRef.current = active

    try {
      await context.resume()
    } catch {
      setNeedsUserStart(true)
      return
    }

    const running = context.state === 'running'
    if (running) {
      beginScheduling(active)
    }
    setIsRunning(running)
    setNeedsUserStart(!running)
  }, [backingTrack])

  useEffect(() => {
    if (!isEnabled) {
      stop()
      return undefined
    }

    void start()
    return stop
  }, [isEnabled, start, stop])

  return { isEnabled, isRunning, needsUserStart, start, stop }
}
