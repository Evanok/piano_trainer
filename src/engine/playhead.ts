/**
 * Where the auto-scroll playhead stands for a position in the piece.
 *
 * It passes over every written onset exactly at that onset's time: between
 * two consecutive onsets (any staff, rests included) it moves at a constant
 * speed from the x of one to the x of the next. That is what lets a note be
 * played "when the band is on it", which is the whole promise of the mode.
 *
 * The earlier version moved at a constant speed through each measure, from
 * one downbeat to the next, because following the notes makes the band speed
 * up and slow down (engraving does not space notes in proportion to their
 * duration). Measured on a real score at 50 bpm, that put the band up to
 * 400ms away from a mid-measure note at the moment it had to be played, more
 * than the whole timing window, so a note played on the band was judged
 * wrong. The error grows as the tempo slows, so slowing down made it worse.
 * Uneven speed is the price of being right where it matters.
 */

export interface MeasureSpan {
  /** Whole notes from the piece's start. */
  start: number
  end: number
  /** Every onset in the measure, in whole notes from the piece's start, ascending. */
  onsets: readonly number[]
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
 * The two anchors around `wholeNotes`: the last onset at or before it (the
 * measure's start when it has none earlier) and the next one after it (the
 * next measure's start, or the end of the last measure).
 */
export function anchorsAround(
  measures: readonly MeasureSpan[],
  index: number,
  wholeNotes: number,
): { from: number; to: number } {
  const measure = measures[index]
  const to = measures[index + 1]?.start ?? measure.end
  let from = measure.start
  let next = to
  for (const onset of measure.onsets) {
    if (onset <= wholeNotes) {
      from = Math.max(from, onset)
    } else if (onset < next) {
      next = onset
    }
  }
  return { from, to: next }
}

/**
 * The playhead's x for `wholeNotes`, from `xAt(t)` (the x of the score at the
 * timestamp t, in whole notes). Null when there is no position before it (a
 * measure the current crop does not draw); it holds still on the last anchor
 * when the next one has no position.
 */
export function playheadX(
  measures: readonly MeasureSpan[],
  wholeNotes: number,
  xAt: (wholeNotes: number) => number | null,
): number | null {
  const index = measureIndexAt(measures, wholeNotes)
  if (index < 0) {
    return null
  }
  const last = measures[measures.length - 1]
  const at = Math.min(wholeNotes, last.end)
  const { from, to } = anchorsAround(measures, index, at)
  const fromX = xAt(from)
  const toX = to > from ? xAt(to) : null
  if (fromX === null || toX === null) {
    return fromX
  }
  const fraction = Math.min(1, Math.max(0, (at - from) / (to - from)))
  return fromX + fraction * (toX - fromX)
}
