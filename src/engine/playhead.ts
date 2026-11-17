/**
 * Where the auto-scroll playhead stands for a position in the piece.
 *
 * Engraving does not space notes in proportion to their duration (a half note
 * takes barely more room than an eighth, a clef or a first note pushes the
 * rest along), so following every note's own x made the playhead speed up and
 * slow down from one note to the next while the tempo never changed. It goes
 * at a constant speed inside each measure instead, from the first note of the
 * measure to the first note of the next: every downbeat still lands exactly on
 * its note, and the speed can only change at a barline, by however much the
 * two measures' widths differ.
 */

export interface MeasureSpan {
  /** Whole notes from the piece's start. */
  start: number
  end: number
}

/** Index of the measure containing `wholeNotes` (the last one past the end), -1 before the first. */
export function measureIndexAt(measures: readonly MeasureSpan[], wholeNotes: number): number {
  let low = 0
  let high = measures.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (measures[middle].start <= wholeNotes) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/**
 * The playhead's x for `wholeNotes`, from `xAtMeasureStart(i)` (the x of
 * measure i's first beat, i === measures.length meaning the end of the last
 * one). Null when either end of the stretch has no position (a measure the
 * current crop does not draw).
 */
export function playheadX(
  measures: readonly MeasureSpan[],
  wholeNotes: number,
  xAtMeasureStart: (index: number) => number | null,
): number | null {
  const index = measureIndexAt(measures, wholeNotes)
  if (index < 0) {
    return null
  }
  const measure = measures[index]
  const from = xAtMeasureStart(index)
  const to = xAtMeasureStart(index + 1)
  if (from === null || to === null) {
    return from
  }
  const length = measure.end - measure.start
  const fraction = length > 0 ? Math.min(1, Math.max(0, (wholeNotes - measure.start) / length)) : 0
  return from + fraction * (to - from)
}
