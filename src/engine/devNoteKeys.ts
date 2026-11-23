/**
 * Development-only piano simulation (`import.meta.env.DEV`, compiled away in
 * production): plays without a MIDI keyboard by feeding a screen's own note
 * handler exactly what a real note-on would reach it with.
 *
 * - `o` plays every expected note not already held (a whole chord at once,
 *   one timestamp, so it lands inside the chord tolerance)
 * - `k` plays one note that is not expected
 *
 * Every screen that listens to MIDI attaches this with its own idea of "what
 * is expected right now", so the two keys mean the same thing everywhere.
 */

export interface DevNoteTarget {
  /** The notes the screen is waiting for right now, empty when none. */
  expected: number[]
  /** The ones already played, which `o` must not strike again. */
  held: number[]
}

/**
 * Pitches the key stands for, or null when the key is not a simulation key.
 * Pure, so it is unit-tested without a DOM.
 */
export function devNotePitches(key: string, target: DevNoteTarget): number[] | null {
  const { expected, held } = target
  switch (key.toLowerCase()) {
    case 'o':
      return expected.filter((pitch) => !held.includes(pitch))
    case 'k': {
      let wrong = (expected[0] ?? 60) + 1
      while (expected.includes(wrong)) {
        wrong += 1
      }
      return [wrong]
    }
    default:
      return null
  }
}

/**
 * Listens for `o`/`k` on the window and calls `play` once per simulated note.
 * Does nothing (and returns a no-op) outside development. Ignored while typing
 * in a field, on auto-repeat and with a modifier held.
 */
export function attachDevNoteKeys(
  getTarget: () => DevNoteTarget,
  play: (pitch: number, timestamp: number) => void,
): () => void {
  if (!import.meta.env.DEV) {
    return () => {}
  }
  const handleKey = (keyEvent: KeyboardEvent) => {
    const target = keyEvent.target as HTMLElement | null
    if (
      keyEvent.repeat ||
      keyEvent.ctrlKey ||
      keyEvent.metaKey ||
      keyEvent.altKey ||
      (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
    ) {
      return
    }
    const pitches = devNotePitches(keyEvent.key, getTarget())
    if (!pitches) {
      return
    }
    const timestamp = performance.now()
    pitches.forEach((pitch) => play(pitch, timestamp))
  }
  window.addEventListener('keydown', handleKey)
  return () => window.removeEventListener('keydown', handleKey)
}
