import { describe, expect, it } from 'vitest'
import { WaitEngine } from './WaitEngine'
import type { ExpectedEvent } from '../types/score'

const C4 = 60
const D4 = 62
const E4 = 64
const F4 = 65
const G4 = 67

describe('WaitEngine', () => {
  it('advances on the correct note and stays blocked on a wrong one', () => {
    const events: ExpectedEvent[] = [
      { index: 0, pitches: [C4] },
      { index: 1, pitches: [D4] },
      { index: 2, pitches: [E4] },
      { index: 3, pitches: [F4] },
    ]
    const engine = new WaitEngine(events)

    expect(engine.noteOn(C4, 0)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(1)

    expect(engine.noteOn(F4, 100)).toBe('error')
    expect(engine.state.currentIndex).toBe(1)

    expect(engine.noteOn(D4, 200)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(2)
  })

  it('validates a chord played in any order within the tolerance window', () => {
    const events: ExpectedEvent[] = [{ index: 0, pitches: [C4, E4, G4] }]
    const engine = new WaitEngine(events)

    expect(engine.noteOn(E4, 0)).toBe('waiting')
    expect(engine.noteOn(G4, 100)).toBe('waiting')
    expect(engine.noteOn(C4, 200)).toBe('done')
    expect(engine.state.completed).toBe(true)
  })

  it('drops stale held notes once the tolerance window elapses, requiring them to be replayed', () => {
    const events: ExpectedEvent[] = [{ index: 0, pitches: [C4, E4, G4] }]
    const engine = new WaitEngine(events, 300)

    engine.noteOn(E4, 0)
    // Gap since E4 exceeds the 300ms tolerance: the window restarts and E4 is dropped.
    expect(engine.noteOn(G4, 500)).toBe('waiting')
    expect(engine.state.currentIndex).toBe(0)

    // Replaying the dropped note within the new window completes the chord.
    expect(engine.noteOn(E4, 600)).toBe('waiting')
    expect(engine.noteOn(C4, 700)).toBe('done')
  })
})
