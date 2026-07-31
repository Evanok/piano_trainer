import { useCallback, useEffect, useRef, useState } from 'react'
import { backingTrackAudioUrl } from '../engine/backingTrack'
import type { PracticeBackingTrack } from '../types/practice'

interface ActiveTrack {
  context: AudioContext
  gain: GainNode
  source: AudioBufferSourceNode
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

// Tracks every AudioContext this hook has created and not yet confirmed
// closed, independent of any particular component instance or in-flight
// async call. If a leak ever slips past the per-call generation guard below,
// nothing in React holds a reference to it any more -- no amount of in-app
// navigation can reach it. stopAllBackingTrackAudio() is a blunt safety net
// the app calls on every screen change away from practice, so a leaked loop
// can never outlive its own screen.
const trackedContexts = new Set<AudioContext>()

function closeTrackedContext(context: AudioContext): void {
  trackedContexts.delete(context)
  try {
    void context.close()
  } catch {
    // Already closed/closing -- nothing to do.
  }
}

export function stopAllBackingTrackAudio(): void {
  for (const context of trackedContexts) {
    closeTrackedContext(context)
  }
}

async function loadBackingTrackBuffer(context: AudioContext, keyName: string): Promise<AudioBuffer | null> {
  const url = backingTrackAudioUrl(keyName)
  if (!url) {
    return null
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`backing track audio not found for ${keyName}: HTTP ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return context.decodeAudioData(arrayBuffer)
}

function stopActiveTrack(active: ActiveTrack): void {
  trackedContexts.delete(active.context)
  const now = active.context.currentTime
  active.gain.gain.cancelScheduledValues(now)
  active.gain.gain.setTargetAtTime(0, now, 0.15)
  try {
    active.source.stop(now + 0.6)
  } catch {
    // Already stopped -- nothing to do.
  }
  window.setTimeout(() => {
    void active.context.close()
  }, 800)
}

export function useBackingTrack(backingTrack: PracticeBackingTrack | null) {
  const activeRef = useRef<ActiveTrack | null>(null)
  // start() awaits a fetch+decode before it has anything in activeRef to hand
  // to stop(). React 18 StrictMode (see main.tsx) deliberately mounts every
  // effect twice in dev -- mount, cleanup, mount again -- to catch exactly
  // this shape of bug: a single shared "am I still live" boolean gets set
  // back to true by the second mount while the first mount's start() call is
  // still awaiting its fetch, so that stale call sees "live" and plays
  // anyway once its fetch resolves, alongside the second, real one. A
  // monotonic generation counter fixes it: each start() call captures the
  // generation current at its own invocation and only proceeds past an await
  // if that generation is still the latest one -- a superseded call can never
  // be un-superseded by a later one the way a shared boolean can be
  // un-flipped.
  const generationRef = useRef(0)
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

    generationRef.current += 1
    const myGeneration = generationRef.current

    if (activeRef.current) {
      try {
        await activeRef.current.context.resume()
      } catch {
        setNeedsUserStart(true)
        return
      }
      if (generationRef.current !== myGeneration) {
        stop()
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
    trackedContexts.add(context)

    let buffer: AudioBuffer | null
    try {
      buffer = await loadBackingTrackBuffer(context, backingTrack.keyName)
    } catch (error) {
      // A missing/unreadable loop must not block practice -- log and leave
      // the backing track silently off, same as a device the user hasn't set up yet.
      console.error('[backingTrack] could not load loop:', error)
      closeTrackedContext(context)
      setNeedsUserStart(false)
      return
    }

    if (!buffer) {
      console.info(`[backingTrack] no loop recorded yet for ${backingTrack.keyName}`)
      closeTrackedContext(context)
      setNeedsUserStart(false)
      return
    }

    if (generationRef.current !== myGeneration) {
      // A newer start() call (unmount, key change, or a StrictMode remount)
      // has already superseded this one -- abandon it unplayed.
      closeTrackedContext(context)
      return
    }

    const gain = context.createGain()
    gain.gain.setValueAtTime(0, context.currentTime)
    gain.gain.linearRampToValueAtTime(0.8, context.currentTime + 0.3)
    gain.connect(context.destination)

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(gain)
    source.start(0)

    activeRef.current = { context, gain, source }

    try {
      await context.resume()
    } catch {
      setNeedsUserStart(true)
      return
    }

    if (generationRef.current !== myGeneration) {
      // Same race, just after the resume() await instead of the load.
      stop()
      return
    }

    const running = context.state === 'running'
    setIsRunning(running)
    setNeedsUserStart(!running)
  }, [backingTrack, stop])

  useEffect(() => {
    if (!isEnabled) {
      generationRef.current += 1
      stop()
      return undefined
    }

    void start()
    return () => {
      generationRef.current += 1
      stop()
    }
  }, [isEnabled, start, stop])

  return { isEnabled, isRunning, needsUserStart, start, stop }
}
