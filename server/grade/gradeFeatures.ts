/**
 * The nine features the difficulty model reads.
 *
 * These are a subset of the eighteen used by piano-syllabus-classifier, chosen
 * (see `docs/auto-grade.md`) so that every one of them can be computed from a
 * score alone: nothing here needs a velocity, a tempo marking or a time
 * signature, none of which a MusicXML file reliably carries.
 *
 * They also all avoid depending on how long a note is *held*. That is not a
 * fact of the score but a rendering convention -- a MIDI renderer shortens
 * every note by a tick, which is enough to flip every eighth note across a
 * "shorter than an eighth" threshold and to deflate an average-polyphony
 * figure. Features built on held duration measured up to ten times differently
 * between a score and a rendering of that same score, so none of them is here.
 *
 * Two of the names are inherited from that project and describe the code
 * rather than the music: `wideLeapRatio` and `repeatedNoteRatio` are computed
 * over *sorted* pitches, so they measure gaps and redundancy in the set of
 * pitches used, not melodic leaps or repeated notes. They are kept exactly as
 * they are because the model was trained on those definitions; the comments
 * below say what each one actually measures.
 */
import { TICKS_PER_QUARTER, type ParsedNote } from './musicXmlNotes.ts'

/** Feature order. Must match `gradeModel.json`'s `features`. */
export const FEATURE_ORDER = [
  'max_polyphony',
  'pitch_range',
  'num_distinct_pitches',
  'chord_ratio',
  'wide_leap_ratio',
  'repeated_note_ratio',
  'low_ratio',
  'high_ratio',
  'hand_independence',
] as const

/** Below this pitch counts as the low register (C3), and C6 upwards as high. */
const LOW_UPPER = 48
const HIGH_LOWER = 72
/** Fixed hand split at middle C, as in the trained model. */
const SPLIT_PITCH = 60
/** Onsets are considered simultaneous within a 32nd-note grid cell. */
const CHORD_GRID = TICKS_PER_QUARTER / 8

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Peak simultaneity, by sweeping note-on / note-off events.
 *
 * Only the peak is kept. The average over the same sweep was measured to
 * disagree by about a quarter between a score and a MIDI rendering of it,
 * because the renderer's one-tick gaps each become a separate low sample,
 * while the peak is reached during the chord itself either way.
 */
function peakPolyphony(notes: ParsedNote[]): number {
  const events: Array<[number, number]> = []
  for (const note of notes) {
    events.push([note.onset, 1])
    events.push([note.onset + note.duration, -1])
  }
  // Note-offs sort before note-ons at the same instant, as in the reference.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  let active = 0
  let previous = 0
  let peak = 0
  for (const [time, delta] of events) {
    if (time > previous && active > peak) {
      peak = active
    }
    active += delta
    previous = time
  }
  return peak
}

/**
 * The raw feature vector, in `FEATURE_ORDER`.
 *
 * An empty or unreadable note list yields all zeros rather than throwing, so a
 * score that cannot be graded still uploads.
 */
export function computeGradeFeatures(notes: ParsedNote[]): number[] {
  if (notes.length === 0) {
    return FEATURE_ORDER.map(() => 0)
  }

  const count = notes.length
  const pitches = notes.map((note) => note.pitch)

  const sorted = [...pitches].sort((a, b) => a - b)
  const distinct = new Set(pitches).size
  const pitchRange = sorted[sorted.length - 1] - sorted[0]

  // Notes sharing a grid cell with at least one other note.
  const perCell = new Map<number, number>()
  for (const note of notes) {
    const cell = Math.floor(note.onset / CHORD_GRID)
    perCell.set(cell, (perCell.get(cell) ?? 0) + 1)
  }
  let chordNotes = 0
  for (const cellCount of perCell.values()) {
    if (cellCount > 1) {
      chordNotes += cellCount
    }
  }

  const low = pitches.filter((pitch) => pitch < LOW_UPPER).length
  const high = pitches.filter((pitch) => pitch >= HIGH_LOWER).length

  // Gaps in the set of pitches used, and how much the piece reuses the same
  // pitches -- both read off the sorted list, see the note at the top.
  let gapsOverOctave = 0
  let repeats = 0
  for (let i = 1; i < sorted.length; i += 1) {
    const step = sorted[i] - sorted[i - 1]
    if (step > 12) {
      gapsOverOctave += 1
    }
    if (step === 0) {
      repeats += 1
    }
  }
  const wideLeapRatio = count > 1 ? gapsOverOctave / count : 0
  const repeatedNoteRatio = count > 1 ? repeats / (count - 1) : 0

  const lowHand = pitches.filter((pitch) => pitch < SPLIT_PITCH)
  const highHand = pitches.filter((pitch) => pitch >= SPLIT_PITCH)
  const handIndependence =
    lowHand.length > 0 && highHand.length > 0 ? Math.abs(mean(lowHand) - mean(highHand)) / 24 : 0

  return [
    peakPolyphony(notes),
    pitchRange,
    distinct,
    chordNotes / count,
    wideLeapRatio,
    repeatedNoteRatio,
    low / count,
    high / count,
    handIndependence,
  ]
}
