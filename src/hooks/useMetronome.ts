import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_METRONOME_SETTINGS,
  Metronome,
  clampBpm,
  resolveMeter,
  type BeatAccent,
  type Meter,
  type MetronomeSettings,
} from '../engine/metronome'
import { loadPreference, savePreference } from '../engine/preferencesStore'

export interface MetronomeState {
  settings: MetronomeSettings
  updateSettings: (patch: Partial<MetronomeSettings>) => void
  /** The meter actually counted: the score's under 'score', else the forced one, or none. */
  meter: Meter | null
  /** Whether the player wants to hear it; independent of the tempo mode. */
  soundOn: boolean
  toggleSound: () => Promise<void>
  /** Registers a beat listener (the icon's flash); returns its unsubscribe. */
  subscribeBeat: (listener: (accent: BeatAccent) => void) => () => void
  /**
   * Puts the clicks on a tempo run's grid: a downbeat at `anchorMs` (the
   * count-in's first beat), muted from `originMs` on when the sound is off, so
   * the count-in is heard either way. With `endMs` (a loop pass) the mute
   * stops there, so the next pass's count-in is heard too.
   */
  startRunGrid: (anchorMs: number, originMs: number, endMs: number | null) => Promise<void>
  /**
   * A loop going round on the same grid: nothing to re-anchor, the next
   * pass's count-in is already being heard, and the clicks (when the sound is
   * off) go quiet again from its `originMs` up to its `endMs`.
   */
  continueRunGrid: (originMs: number, endMs: number) => void
  /** The run is over: the clicks stop unless the player has the sound on. */
  endRunGrid: () => void
}

/**
 * The practice screen's one metronome. Shared by its panel and by the tempo
 * mode, which scrolls at its tempo and counts in with it, so there is a single
 * bpm to set. Settings persist per device; the sound being on does not.
 */
export function useMetronome(scoreMeter: Meter | null): MetronomeState {
  const [settings, setSettings] = useState<MetronomeSettings>(() =>
    loadPreference('metronome', DEFAULT_METRONOME_SETTINGS),
  )
  const [soundOn, setSoundOn] = useState(false)
  const soundOnRef = useRef(false)
  const runActiveRef = useRef(false)
  // The run's downbeat, kept so the sound turned on mid-run joins its grid.
  const gridAnchorRef = useRef<number | null>(null)
  const metronomeRef = useRef<Metronome | null>(null)
  const listenersRef = useRef(new Set<(accent: BeatAccent) => void>())
  const meter = useMemo(
    () => resolveMeter(settings.meter, scoreMeter),
    // A fresh object per render would restart the update effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.meter, scoreMeter?.numerator, scoreMeter?.denominator],
  )

  const getMetronome = useCallback(() => {
    if (!metronomeRef.current) {
      const metronome = new Metronome(settings.bpm, meter, settings.volume)
      metronome.onBeat = (accent) => listenersRef.current.forEach((listener) => listener(accent))
      metronomeRef.current = metronome
    }
    return metronomeRef.current
    // Only the first call creates it; later settings arrive through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    savePreference('metronome', settings)
  }, [settings])

  useEffect(() => {
    metronomeRef.current?.update(settings.bpm, meter, settings.volume)
  }, [settings.bpm, settings.volume, meter])

  useEffect(() => {
    return () => {
      metronomeRef.current?.dispose()
      metronomeRef.current = null
    }
  }, [])

  const updateSettings = useCallback((patch: Partial<MetronomeSettings>) => {
    setSettings((current) => ({
      ...current,
      ...patch,
      ...(patch.bpm !== undefined ? { bpm: clampBpm(patch.bpm) } : {}),
    }))
  }, [])

  const setSound = (on: boolean) => {
    soundOnRef.current = on
    setSoundOn(on)
  }

  const toggleSound = useCallback(async () => {
    const metronome = getMetronome()
    const next = !soundOnRef.current
    if (runActiveRef.current) {
      if (metronome.isRunning) {
        // Already ticking on the run's grid (maybe muted): only the mute changes.
        metronome.setSilentFrom(next ? null : performance.now())
        setSound(next)
        return
      }
      if (next && gridAnchorRef.current !== null) {
        // A past anchor is fine: the scheduler skips ahead to the next beat
        // of that grid, accents included.
        setSound(await metronome.start({ anchorMs: gridAnchorRef.current }))
        return
      }
    }
    if (next) {
      setSound(await metronome.start())
    } else {
      metronome.stop()
      setSound(false)
    }
  }, [getMetronome])

  const subscribeBeat = useCallback((listener: (accent: BeatAccent) => void) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const startRunGrid = useCallback(
    async (anchorMs: number, originMs: number, endMs: number | null) => {
      runActiveRef.current = true
      gridAnchorRef.current = anchorMs
      const metronome = getMetronome()
      await metronome.start({ anchorMs, silentFromMs: soundOnRef.current ? null : originMs })
      if (!soundOnRef.current && endMs !== null) {
        metronome.setSilentFrom(originMs, endMs)
      }
    },
    [getMetronome],
  )

  const continueRunGrid = useCallback((originMs: number, endMs: number) => {
    runActiveRef.current = true
    if (!soundOnRef.current) {
      metronomeRef.current?.setSilentFrom(originMs, endMs)
    }
  }, [])

  const endRunGrid = useCallback(() => {
    runActiveRef.current = false
    gridAnchorRef.current = null
    if (!soundOnRef.current) {
      metronomeRef.current?.stop()
    }
  }, [])

  return { settings, updateSettings, meter, soundOn, toggleSound, subscribeBeat, startRunGrid, continueRunGrid, endRunGrid }
}
