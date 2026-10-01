import { useEffect, useMemo, useState } from 'react'
import { fetchCatalogChords, fetchKeySignatureCounts } from '../api/catalog'
import type { ChordRoundInputs } from '../engine/chordQuiz'
import type { CatalogChord, ChordQuizSettings } from '../types/chord'

interface Fetched<T> {
  data: T | null
  error: string | null
  done: boolean
}

/** One request, made when `enabled` turns true; aborted on unmount. */
function useFetched<T>(enabled: boolean, fetcher: (signal: AbortSignal) => Promise<T>): Fetched<T> {
  const [state, setState] = useState<Fetched<T>>({ data: null, error: null, done: false })
  useEffect(() => {
    if (!enabled) {
      return
    }
    const controller = new AbortController()
    fetcher(controller.signal)
      .then((data) => setState({ data, error: null, done: true }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ data: null, error: error instanceof Error ? error.message : String(error), done: true })
        }
      })
    return () => controller.abort()
    // The fetchers are module functions, so `enabled` is the only real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
  return state
}

/** The catalog's chords, fetched only when the settings draw from them. */
export function useCatalogChords(enabled: boolean): Fetched<CatalogChord[]> {
  return useFetched(enabled, fetchCatalogChords)
}

/**
 * Everything a chord round needs from the server, fetched where the round is
 * built. `inputs` stays null until every needed request has answered. A failed
 * key statistic is not an error (the round falls back to the common keys); a
 * failed chord list is, since a round silently made of generated chords is not
 * what was asked for.
 */
export function useChordRoundInputs(settings: Pick<ChordQuizSettings, 'keyMode' | 'material'>): {
  inputs: ChordRoundInputs | null
  error: string | null
} {
  const wantsKeys = settings.keyMode === 'random'
  const wantsChords = settings.material === 'catalog'
  const keys = useFetched(wantsKeys, fetchKeySignatureCounts)
  const chords = useCatalogChords(wantsChords)
  const ready = (!wantsKeys || keys.done) && (!wantsChords || chords.done)
  // One stable object per answer: the round is memoized on it, and a new
  // object every render would rebuild the round (and reset the engine) each time.
  const inputs = useMemo<ChordRoundInputs>(
    () => ({ keyCounts: keys.data, catalogChords: chords.data }),
    [keys.data, chords.data],
  )
  if (wantsChords && chords.error) {
    return { inputs: null, error: chords.error }
  }
  return { inputs: ready ? inputs : null, error: null }
}
