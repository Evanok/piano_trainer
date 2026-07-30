import { useCallback, useEffect, useRef, useState } from 'react'
import { buildSoftPadVoices, midiToFrequency } from '../engine/backingTrack'
import type { PracticeBackingTrack } from '../types/practice'

interface ActivePad {
  context: AudioContext
  masterGain: GainNode
  oscillators: OscillatorNode[]
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

function stopActivePad(active: ActivePad): void {
  const now = active.context.currentTime
  active.masterGain.gain.cancelScheduledValues(now)
  active.masterGain.gain.setTargetAtTime(0, now, 0.18)
  active.oscillators.forEach((oscillator) => oscillator.stop(now + 0.7))
  window.setTimeout(() => {
    void active.context.close()
  }, 900)
}

export function useSoftBackingTrack(backingTrack: PracticeBackingTrack | null) {
  const activeRef = useRef<ActivePad | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [needsUserStart, setNeedsUserStart] = useState(false)
  const isEnabled = backingTrack?.enabled === true

  const stop = useCallback(() => {
    const active = activeRef.current
    if (!active) {
      return
    }
    activeRef.current = null
    stopActivePad(active)
    setIsRunning(false)
    setNeedsUserStart(false)
  }, [])

  const start = useCallback(async () => {
    if (!backingTrack?.enabled) {
      return
    }

    if (activeRef.current) {
      try {
        await activeRef.current.context.resume()
      } catch {
        setNeedsUserStart(true)
        return
      }
      const running = activeRef.current.context.state === 'running'
      setIsRunning(running)
      setNeedsUserStart(!running)
      return
    }

    const context = createAudioContext()
    if (!context) {
      setNeedsUserStart(false)
      return
    }

    const now = context.currentTime
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1200, now)
    filter.Q.setValueAtTime(0.35, now)

    const masterGain = context.createGain()
    masterGain.gain.setValueAtTime(0, now)
    masterGain.gain.linearRampToValueAtTime(0.035, now + 1.4)
    filter.connect(masterGain)
    masterGain.connect(context.destination)

    const oscillators = buildSoftPadVoices(backingTrack.tonicPitchClass).map((voice) => {
      const oscillator = context.createOscillator()
      const voiceGain = context.createGain()
      oscillator.type = voice.type
      oscillator.frequency.setValueAtTime(midiToFrequency(voice.midi), now)
      oscillator.detune.setValueAtTime(voice.detuneCents, now)
      voiceGain.gain.setValueAtTime(voice.gain, now)
      oscillator.connect(voiceGain)
      voiceGain.connect(filter)
      oscillator.start(now)
      return oscillator
    })

    activeRef.current = { context, masterGain, oscillators }

    try {
      await context.resume()
    } catch {
      setNeedsUserStart(true)
      return
    }

    const running = context.state === 'running'
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
