import { describe, expect, it } from 'vitest'
import { computeSections, lastMeasureNumber, sectionForMeasureRange } from './sections'
import type { ExpectedEvent } from '../types/score'

// One event per measure -- keeps expected event indices trivially equal to
// (measureNumber - 1), so boundary assertions read directly as measure math.
function eventsPerMeasure(measureCount: number): ExpectedEvent[] {
  return Array.from({ length: measureCount }, (_, i) => ({ index: i, pitches: [60], measureNumber: i + 1 }))
}

describe('computeSections', () => {
  it('returns nothing for an empty piece', () => {
    expect(computeSections([], 8)).toEqual([])
  })

  it('splits an exact multiple of measuresPerSection into even chunks', () => {
    const sections = computeSections(eventsPerMeasure(16), 8)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({ startMeasure: 1, endMeasure: 8, startEventIndex: 0, endEventIndex: 8 })
    expect(sections[1]).toMatchObject({ startMeasure: 9, endMeasure: 16, startEventIndex: 8, endEventIndex: 16 })
  })

  it('gives the last, shorter section the remainder', () => {
    const sections = computeSections(eventsPerMeasure(20), 8)
    expect(sections).toHaveLength(3)
    expect(sections[2]).toMatchObject({ startMeasure: 17, endMeasure: 20, startEventIndex: 16, endEventIndex: 20 })
  })

  it('produces a single section covering everything when the piece is shorter than one section', () => {
    const sections = computeSections(eventsPerMeasure(5), 8)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ startMeasure: 1, endMeasure: 5, startEventIndex: 0, endEventIndex: 5 })
  })

  it('resolves boundaries via actual event indices, not a naive measure count, when measures hold multiple events', () => {
    const events: ExpectedEvent[] = [
      { index: 0, pitches: [60], measureNumber: 1 },
      { index: 1, pitches: [62], measureNumber: 1 }, // measure 1 has 2 events
      { index: 2, pitches: [64], measureNumber: 2 },
      { index: 3, pitches: [65], measureNumber: 3 },
    ]
    const sections = computeSections(events, 2)
    // measures 1-2 hold events 0,1 (both measure 1) and 2 (measure 2) -> endEventIndex 3, not a naive 2.
    expect(sections[0]).toMatchObject({ startMeasure: 1, endMeasure: 2, startEventIndex: 0, endEventIndex: 3 })
    expect(sections[1]).toMatchObject({ startMeasure: 3, endMeasure: 3, startEventIndex: 3, endEventIndex: 4 })
  })

  it('snaps a boundary to a natural break within tolerance instead of the raw fixed-size cut', () => {
    const events = eventsPerMeasure(20)
    // Raw boundary would land at measure 9 (8+1); a natural break at measure 10 is within the 2-measure tolerance.
    const sections = computeSections(events, 8, new Set([10]))
    expect(sections[0]).toMatchObject({ startMeasure: 1, endMeasure: 9 })
    expect(sections[1].startMeasure).toBe(10)
  })

  it('ignores a natural break outside the snap tolerance', () => {
    const events = eventsPerMeasure(30)
    // Raw boundary at measure 9; a break at measure 15 is far outside tolerance (2).
    const sections = computeSections(events, 8, new Set([15]))
    expect(sections[0]).toMatchObject({ startMeasure: 1, endMeasure: 8 })
  })

  it('never lets a natural break collapse a section to zero length', () => {
    const events = eventsPerMeasure(20)
    // A break sitting at the section's own start measure must not be picked
    // as its end boundary.
    const sections = computeSections(events, 4, new Set([1, 2]))
    expect(sections[0].endMeasure).toBeGreaterThanOrEqual(sections[0].startMeasure)
  })

  it('always covers every event exactly once, contiguously, regardless of measuresPerSection', () => {
    const events = eventsPerMeasure(37)
    const sections = computeSections(events, 5, new Set([12, 30]))
    expect(sections[0].startEventIndex).toBe(0)
    expect(sections[sections.length - 1].endEventIndex).toBe(events.length)
    for (let i = 1; i < sections.length; i += 1) {
      expect(sections[i].startEventIndex).toBe(sections[i - 1].endEventIndex)
    }
  })
})

// The user-picked loop range of "Scroll loop", built as one Section so it
// shares the crop/jump/end-of-range path with the fixed-size sections.
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
