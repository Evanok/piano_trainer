import { describe, expect, it } from 'vitest'
import { WaitEngine } from './WaitEngine'
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

  it('scenario 3: a wrong note resets all progress on the current chord, regardless of timing', () => {
    const events: ExpectedEvent[] = [event(0, [C4, D4, F4, A4])]
    const engine = new WaitEngine(events, 300)

    engine.noteOn(C4, 0)
    expect(engine.currentHeldPitches).toEqual([C4])

    expect(engine.noteOn(E4, 50)).toBe('error')
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
