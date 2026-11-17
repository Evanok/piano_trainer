import { describe, expect, it } from 'vitest'
import {
  GOOD_WINDOW_MS,
  ON_TIME_WINDOW_MS,
  TempoEngine,
  addSettledEvent,
  classifyOffset,
  emptyTempoStats,
  tempoWindows,
} from './TempoEngine'

const events = [
  { index: 0, pitches: [60], timeMs: 1000 },
  { index: 1, pitches: [62], timeMs: 1500 },
  { index: 2, pitches: [64, 67], timeMs: 2000 },
]

describe('classifyOffset', () => {
  it('splits on time, early and late', () => {
    expect(classifyOffset(0)).toBe('onTime')
    expect(classifyOffset(-70)).toBe('onTime')
    expect(classifyOffset(-100)).toBe('early')
    expect(classifyOffset(120)).toBe('late')
  })
})

describe('TempoEngine', () => {
  it('settles a note played on its beat', () => {
    const engine = new TempoEngine(events)
    const outcome = engine.noteOn(60, 1020)
    expect(outcome).toEqual({ kind: 'hit', index: 0, offsetMs: 20, settled: { index: 0, result: 'onTime', offsetMs: 20 } })
    expect(engine.currentIndex).toBe(1)
  })

  it('marks early and late presses', () => {
    const engine = new TempoEngine(events)
    expect(engine.noteOn(60, 880)).toMatchObject({ settled: { result: 'early' } })
    expect(engine.noteOn(62, 1640)).toMatchObject({ settled: { result: 'late' } })
  })

  it('treats a press outside every window as wrong', () => {
    const engine = new TempoEngine(events)
    expect(engine.noteOn(60, 1000 + GOOD_WINDOW_MS + 50)).toEqual({ kind: 'wrong', nearestIndex: 0 })
    expect(engine.noteOn(61, 1000)).toEqual({ kind: 'wrong', nearestIndex: 0 })
  })

  it('settles a chord only once every note is in, judging the worst one', () => {
    const engine = new TempoEngine(events)
    engine.advance(1800)
    const first = engine.noteOn(64, 2000)
    expect(first).toMatchObject({ kind: 'hit', settled: null })
    expect(engine.noteOn(67, 2110)).toMatchObject({ settled: { index: 2, result: 'late' } })
    expect(engine.isFinished).toBe(true)
  })

  it('reports an event as missed once its window has closed', () => {
    const engine = new TempoEngine(events)
    expect(engine.advance(1000 + GOOD_WINDOW_MS)).toEqual([])
    expect(engine.advance(1000 + GOOD_WINDOW_MS + 1)).toEqual([{ index: 0, result: 'missed', offsetMs: null }])
    expect(engine.currentIndex).toBe(1)
  })

  it('matches a press to the nearest open note of that pitch', () => {
    const engine = new TempoEngine([
      { index: 0, pitches: [60], timeMs: 1000 },
      { index: 1, pitches: [60], timeMs: 1150 },
    ])
    expect(engine.noteOn(60, 1120)).toMatchObject({ index: 1 })
    expect(engine.noteOn(60, 1130)).toMatchObject({ index: 0, settled: { result: 'late' } })
  })

  it('does not take the same note twice', () => {
    const engine = new TempoEngine(events)
    engine.noteOn(60, 1000)
    expect(engine.noteOn(60, 1010)).toMatchObject({ kind: 'wrong' })
  })
})

describe('tempo stats', () => {
  it('counts results and averages the offset of played events', () => {
    let stats = emptyTempoStats(80)
    stats = addSettledEvent(stats, { index: 0, result: 'onTime', offsetMs: 10 })
    stats = addSettledEvent(stats, { index: 1, result: 'late', offsetMs: 110 })
    stats = addSettledEvent(stats, { index: 2, result: 'missed', offsetMs: null })
    expect(stats).toEqual({ bpm: 80, onTime: 1, early: 0, late: 1, missed: 1, meanOffsetMs: 60 })
  })
})

describe('tempoWindows', () => {
  it('matches the fixed windows at 120 bpm and scales with the beat', () => {
    expect(tempoWindows(500)).toEqual({ onTimeMs: ON_TIME_WINDOW_MS, goodMs: GOOD_WINDOW_MS })
    // 50 bpm: a beat of 1200ms.
    expect(tempoWindows(1200)).toEqual({ onTimeMs: 168, goodMs: 432 })
  })

  it('keeps a floor at fast tempos', () => {
    expect(tempoWindows(200)).toEqual({ onTimeMs: 40, goodMs: 100 })
  })

  it('judges with the windows it was given', () => {
    const engine = new TempoEngine([{ index: 0, pitches: [60], timeMs: 1000 }], tempoWindows(1200))
    expect(engine.noteOn(60, 1000 + 400)).toMatchObject({ kind: 'hit', settled: { result: 'late' } })
    const onTime = new TempoEngine([{ index: 0, pitches: [60], timeMs: 1000 }], tempoWindows(1200))
    expect(onTime.noteOn(60, 1000 - 150)).toMatchObject({ kind: 'hit', settled: { result: 'onTime' } })
  })
})

describe('dueIndex', () => {
  it('shows a note only once its window has opened, and nothing once it is played', () => {
    const engine = new TempoEngine(events)
    expect(engine.dueIndex(1000 - GOOD_WINDOW_MS - 1)).toBeNull()
    expect(engine.dueIndex(1000 - GOOD_WINDOW_MS)).toBe(0)
    engine.noteOn(60, 1000)
    // The next note is 500ms later: dark until its own window opens.
    expect(engine.dueIndex(1010)).toBeNull()
    expect(engine.dueIndex(1500 - GOOD_WINDOW_MS)).toBe(1)
  })
})
