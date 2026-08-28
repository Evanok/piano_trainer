import type { ExpectedEvent } from '../types/score'

export interface Section {
  index: number
  label: string
  startEventIndex: number
  endEventIndex: number // exclusive
  startMeasure: number
  endMeasure: number // inclusive
}

const SNAP_TOLERANCE_MEASURES = 2

/**
 * Splits a piece into practice sections of roughly `measuresPerSection`
 * measures each. `naturalBreakMeasures` (1-based measure numbers known to
 * start a new musical section -- a rehearsal mark, or the measure right
 * after a double/final barline, see ScoreParser.extractNaturalBreakMeasures)
 * snaps a nearby fixed-size boundary onto one of these instead, within
 * SNAP_TOLERANCE_MEASURES, so a section doesn't get chopped mid-phrase.
 * Falls back to plain fixed-size chunking wherever no such marker exists
 * nearby -- the common case for scores without structure markup.
 */
/** The piece's last measure number, which is what every measure-space control
 * (the section list, the loop range bar) has to clamp against. Read off the
 * events rather than the score, so it always means "the last measure that
 * actually requires a keypress in the current hand mode". */
export function lastMeasureNumber(events: ExpectedEvent[]): number {
  return events.length === 0 ? 0 : events[events.length - 1].measureNumber
}

/**
 * Events aren't one-per-measure (rests and tie continuations are filtered out,
 * and a dense measure holds several), so a measure-space boundary has to be
 * resolved to an event index by lookup, never by assuming even spacing. A
 * measure with no playable event at all resolves to the next one that has any,
 * and past the end to events.length -- which is exactly the exclusive end index
 * a range wants.
 */
export function eventIndexAtOrAfterMeasure(events: ExpectedEvent[], measure: number): number {
  // Events come out of the cursor walk in measure order, so the first one that
  // has reached the measure is the answer.
  const found = events.findIndex((event) => event.measureNumber >= measure)
  return found === -1 ? events.length : found
}

/**
 * The measures `startMeasure`..`endMeasure` (both inclusive, 1-based) as one
 * Section, which is what "Scroll loop" loops over. It is deliberately the
 * same shape the fixed-size sections use, so the crop, the cursor jump and the
 * end-of-range detection in Practice are one code path for both. A range
 * reaching past either end of the piece is clamped into it rather than
 * rejected; only a piece with no events at all answers null.
 */
export function sectionForMeasureRange(
  events: ExpectedEvent[],
  startMeasure: number,
  endMeasure: number,
): Section | null {
  const totalMeasures = lastMeasureNumber(events)
  if (totalMeasures === 0) {
    return null
  }
  const start = Math.min(Math.max(1, Math.round(startMeasure)), totalMeasures)
  const end = Math.min(Math.max(start, Math.round(endMeasure)), totalMeasures)
  const startEventIndex = eventIndexAtOrAfterMeasure(events, start)
  const endEventIndex = eventIndexAtOrAfterMeasure(events, end + 1)
  if (startEventIndex >= endEventIndex) {
    return null
  }
  return {
    index: 0,
    label: `Measures ${start}-${end}`,
    startEventIndex,
    endEventIndex,
    startMeasure: start,
    endMeasure: end,
  }
}

export function computeSections(
  events: ExpectedEvent[],
  measuresPerSection: number,
  naturalBreakMeasures: ReadonlySet<number> = new Set(),
): Section[] {
  if (events.length === 0 || measuresPerSection < 1) {
    return []
  }
  const totalMeasures = lastMeasureNumber(events)

  // Events aren't one-per-measure (rests/ties are filtered out, and a dense
  // measure can hold several events), so a measure-space boundary has to be
  // resolved to an event index via this map, not assumed evenly spaced.
  const firstEventIndexAtMeasure = new Map<number, number>()
  events.forEach((event, i) => {
    if (!firstEventIndexAtMeasure.has(event.measureNumber)) {
      firstEventIndexAtMeasure.set(event.measureNumber, i)
    }
  })
  function eventIndexAtOrAfterMeasure(measure: number): number {
    for (let m = measure; m <= totalMeasures; m += 1) {
      const idx = firstEventIndexAtMeasure.get(m)
      if (idx !== undefined) {
        return idx
      }
    }
    return events.length
  }

  // minMeasure keeps the snapped boundary strictly after the section's own
  // start, so a natural break sitting right at (or before) startMeasure can
  // never collapse this section to zero length.
  function snapBoundary(rawMeasure: number, minMeasure: number): number {
    let best = rawMeasure
    let bestDistance = Infinity
    const lo = Math.max(minMeasure, rawMeasure - SNAP_TOLERANCE_MEASURES)
    const hi = Math.min(totalMeasures, rawMeasure + SNAP_TOLERANCE_MEASURES)
    for (let m = lo; m <= hi; m += 1) {
      if (naturalBreakMeasures.has(m)) {
        const distance = Math.abs(m - rawMeasure)
        if (distance < bestDistance) {
          bestDistance = distance
          best = m
        }
      }
    }
    return best
  }

  const sections: Section[] = []
  let startMeasure = 1
  while (startMeasure <= totalMeasures) {
    const rawNextStart = startMeasure + measuresPerSection
    const nextStart = rawNextStart > totalMeasures ? totalMeasures + 1 : snapBoundary(rawNextStart, startMeasure + 1)
    const startEventIndex = eventIndexAtOrAfterMeasure(startMeasure)
    const endEventIndex = nextStart > totalMeasures ? events.length : eventIndexAtOrAfterMeasure(nextStart)
    sections.push({
      index: sections.length,
      label: `Measures ${startMeasure}-${nextStart - 1}`,
      startEventIndex,
      endEventIndex,
      startMeasure,
      endMeasure: nextStart - 1,
    })
    startMeasure = nextStart
  }
  return sections
}
