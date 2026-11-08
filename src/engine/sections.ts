import type { ExpectedEvent } from '../types/score'

export interface Section {
  index: number
  label: string
  startEventIndex: number
  endEventIndex: number // exclusive
  startMeasure: number
  endMeasure: number // inclusive
}

/** The piece's last measure number, which is what every measure-space control
 * (the loop range bar) has to clamp against. Read off the
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
 * Section, which is what "Scroll loop" loops over and what Practice crops the
 * score to. A range
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
