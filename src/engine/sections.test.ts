import { describe, expect, it } from 'vitest'
import { lastMeasureNumber, sectionForMeasureRange } from './sections'
import type { ExpectedEvent } from '../types/score'

describe('sectionForMeasureRange', () => {
  const events: ExpectedEvent[] = [
    { index: 0, pitches: [60], measureNumber: 1 },
    { index: 1, pitches: [62], measureNumber: 2 },
    { index: 2, pitches: [64], measureNumber: 2 },
    { index: 3, pitches: [65], measureNumber: 4 }, // measure 3 is silent
    { index: 4, pitches: [67], measureNumber: 5 },
  ]

  it('resolves a range to the events it actually contains', () => {
    expect(sectionForMeasureRange(events, 2, 4)).toMatchObject({
      startMeasure: 2,
      endMeasure: 4,
      startEventIndex: 1,
      endEventIndex: 4,
      label: 'Measures 2-4',
    })
  })

  it('runs to the end of the piece when the range does', () => {
    expect(sectionForMeasureRange(events, 4, 5)).toMatchObject({ startEventIndex: 3, endEventIndex: 5 })
  })

  it('starts at the next measure that has anything to play', () => {
    // Measure 3 holds no required note, so a range opening on it starts on 4.
    expect(sectionForMeasureRange(events, 3, 5)).toMatchObject({ startEventIndex: 3, endEventIndex: 5 })
  })

  it('clamps a range that runs past either end of the piece', () => {
    expect(sectionForMeasureRange(events, 0, 99)).toMatchObject({ startMeasure: 1, endMeasure: 5 })
  })

  it('answers nothing only for a piece with no events at all', () => {
    // Anything else is clamped into the piece rather than rejected: a range
    // past the end of a one-measure piece still means that one measure.
    expect(sectionForMeasureRange([{ index: 0, pitches: [60], measureNumber: 1 }], 3, 3)).toMatchObject({
      startMeasure: 1,
      endMeasure: 1,
    })
    expect(sectionForMeasureRange([], 1, 4)).toBeNull()
  })

  it('reports the piece length from its last event', () => {
    expect(lastMeasureNumber(events)).toBe(5)
    expect(lastMeasureNumber([])).toBe(0)
  })
})
