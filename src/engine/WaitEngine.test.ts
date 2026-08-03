import { describe, expect, it } from 'vitest'
import { DEFAULT_CHORD_TOLERANCE_MS, WaitEngine } from './WaitEngine'
import type { ExpectedEvent } from '../types/score'

const C4 = 60
const D4 = 62
const E4 = 64
const F4 = 65
const G4 = 67
const A4 = 69

function event(index: number, pitches: number[], measureNumber = 1): ExpectedEvent {
  return { index, pitches, measureNumber }
}

describe('WaitEngine', () => {
  it('advances on the correct note and stays blocked on a wrong one', () => {
    const events: ExpectedEvent[] = [
      event(0, [C4]),
      event(1, [D4]),
      event(2, [E4]),
      event(3, [F4]),
    ]
    const engine = new WaitEngine(events)

    expect(engine.noteOn(C4, 0)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(1)

    expect(engine.noteOn(F4, 100)).toBe('error')
    expect(engine.state.currentIndex).toBe(1)

    expect(engine.noteOn(D4, 200)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(2)
  })

  it('scenario 1: notes played close together (within tolerance) stack into one chord attempt', () => {
    const events: ExpectedEvent[] = [event(0, [C4, D4, F4, A4])]
    const engine = new WaitEngine(events, 300)

    expect(engine.noteOn(C4, 0)).toBe('waiting')
    expect(engine.currentHeldPitches).toEqual([C4])

    expect(engine.noteOn(D4, 50)).toBe('waiting')
    expect(engine.currentHeldPitches.sort((a, b) => a - b)).toEqual([C4, D4])
  })

  it('scenario 2: a correct note played too long after the previous one expires the earlier hold', () => {
    const events: ExpectedEvent[] = [event(0, [C4, D4, F4, A4])]
    const engine = new WaitEngine(events, 300)

    expect(engine.noteOn(C4, 0)).toBe('waiting')
    expect(engine.currentHeldPitches).toEqual([C4])

    // 5 seconds later: C4's hold has expired, only D4 should now be held.
    expect(engine.noteOn(D4, 5000)).toBe('waiting')
    expect(engine.currentHeldPitches).toEqual([D4])
    expect(engine.state.currentIndex).toBe(0)
  })

  it('scenario 3a: a wrong note within the tolerance window is reported but does not erase already-held correct notes', () => {
    const events: ExpectedEvent[] = [event(0, [C4, D4, F4, A4])]
    const engine = new WaitEngine(events, 300)

    engine.noteOn(C4, 0)
    expect(engine.currentHeldPitches).toEqual([C4])

    // A wrong note landing 50ms later is the same simultaneous attempt (one
    // finger slipped while pressing a chord with several correct fingers) --
    // C4 must stay held.
    expect(engine.noteOn(E4, 50)).toBe('error')
    expect(engine.currentHeldPitches).toEqual([C4])
  })

  it('scenario 3b: a wrong note after the tolerance window has elapsed resets all progress', () => {
    const events: ExpectedEvent[] = [event(0, [C4, D4, F4, A4])]
    const engine = new WaitEngine(events, 300)

    engine.noteOn(C4, 0)
    expect(engine.currentHeldPitches).toEqual([C4])

    // A wrong note landing 5s later is a distinct, later attempt -- full reset.
    expect(engine.noteOn(E4, 5000)).toBe('error')
    expect(engine.currentHeldPitches).toEqual([])
  })

  it('validates a chord played in any order within the tolerance window', () => {
    const events: ExpectedEvent[] = [event(0, [C4, E4, G4])]
    const engine = new WaitEngine(events, 300)

    expect(engine.noteOn(E4, 0)).toBe('waiting')
    expect(engine.noteOn(G4, 100)).toBe('waiting')
    expect(engine.noteOn(C4, 200)).toBe('done')
    expect(engine.state.completed).toBe(true)
  })

  it('finds the first event at or after a given measure, and jumps to it cleanly', () => {
    const events: ExpectedEvent[] = [
      event(0, [C4], 1),
      event(1, [D4], 1),
      event(2, [E4], 2),
      event(3, [F4], 3),
    ]
    const engine = new WaitEngine(events)

    engine.noteOn(C4, 0)
    expect(engine.findEventIndexForMeasure(2)).toBe(2)
    expect(engine.findEventIndexForMeasure(3)).toBe(3)
    expect(engine.findEventIndexForMeasure(4)).toBeNull()

    engine.jumpToEventIndex(2)
    expect(engine.state.currentIndex).toBe(2)
    expect(engine.currentHeldPitches).toEqual([])
  })
})

describe('WaitEngine free mode', () => {
  // One event per measure keeps "how far ahead did it look" readable: with a
  // 2-measure window, the cursor can reach at most two events past itself.
  function scale(): ExpectedEvent[] {
    return [
      event(0, [C4], 1),
      event(1, [D4], 2),
      event(2, [E4], 3),
      event(3, [F4], 4),
      event(4, [G4], 5),
      event(5, [A4], 6),
    ]
  }

  function freeEngine(events = scale(), windowMeasures = 2): WaitEngine {
    const engine = new WaitEngine(events, DEFAULT_CHORD_TOLERANCE_MS, windowMeasures)
    engine.setMode('free')
    return engine
  }

  it('advances on the expected note exactly like wait mode', () => {
    const engine = freeEngine()
    expect(engine.noteOn(C4, 0)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(1)
  })

  it('never blocks on a wrong note, and does not move for it', () => {
    const engine = freeEngine()
    // A4 is five measures away -- outside the window, so it matches nothing.
    expect(engine.noteOn(A4, 0)).toBe('error')
    expect(engine.state.currentIndex).toBe(0)
    // Still perfectly playable: the run continues from where it was.
    expect(engine.noteOn(C4, 100)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(1)
  })

  it('re-anchors onto the player when notes are skipped', () => {
    const engine = freeEngine()
    // Skip D4 entirely and play the note after it.
    expect(engine.noteOn(E4, 0)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(3)
  })

  it('recovers position after playing on through a mistake', () => {
    const engine = freeEngine()
    engine.noteOn(C4, 0)
    // Wrong note, not corrected -- the player just keeps going.
    expect(engine.noteOn(C4, 100)).toBe('error')
    expect(engine.noteOn(D4, 200)).toBe('waiting')
    // Back on the player rather than stuck behind the uncorrected mistake.
    expect(engine.state.currentIndex).toBe(2)
  })

  it('abandons a half-played chord instead of waiting for the rest of it', () => {
    const engine = freeEngine([
      event(0, [C4, E4, G4], 1),
      event(1, [D4], 2),
      event(2, [F4], 3),
    ])
    expect(engine.noteOn(C4, 0)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(0)
    expect(engine.currentHeldPitches).toEqual([C4])
    // The player moved on without completing the chord.
    expect(engine.noteOn(D4, 100)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(2)
    expect(engine.currentHeldPitches).toEqual([])
  })

  it('takes the nearest match so a recurring pitch cannot pull the cursor ahead', () => {
    const engine = freeEngine([
      event(0, [C4], 1),
      event(1, [D4], 1),
      event(2, [C4], 2),
    ])
    // C4 appears at index 0 and index 2, both inside the window.
    expect(engine.noteOn(C4, 0)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(1)
  })

  it('never looks backwards -- a note already played does not rewind the cursor', () => {
    const engine = freeEngine()
    engine.noteOn(C4, 0)
    engine.noteOn(D4, 100)
    expect(engine.state.currentIndex).toBe(2)
    expect(engine.noteOn(C4, 200)).toBe('error')
    expect(engine.state.currentIndex).toBe(2)
  })

  it('reaches the end of the piece even when notes were skipped along the way', () => {
    const engine = freeEngine()
    engine.noteOn(C4, 0)
    engine.noteOn(E4, 100)
    engine.noteOn(G4, 200)
    expect(engine.noteOn(A4, 300)).toBe('done')
    expect(engine.state.completed).toBe(true)
  })

  it('switching mode leaves the player exactly where they were', () => {
    const engine = new WaitEngine(scale())
    engine.noteOn(C4, 0)
    engine.noteOn(D4, 100)
    engine.setMode('free')
    expect(engine.state.currentIndex).toBe(2)
    engine.setMode('wait')
    expect(engine.state.currentIndex).toBe(2)
    // And wait mode blocks again straight away.
    expect(engine.noteOn(A4, 200)).toBe('error')
    expect(engine.state.currentIndex).toBe(2)
  })
})
