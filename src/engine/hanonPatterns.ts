/**
 * Hanon, "The Virtuoso Pianist" (1873), Part 1 -- exercises 1 to 20.
 *
 * Every one of these is the same construction: a short figure is stated on a
 * root, and that root walks up the scale one degree per measure, then comes
 * back down. So the exercise is stored as its *rule* rather than as notes --
 * which is the whole reason this is generated instead of shipping score files.
 * Regenerating gives transposition to any key and free choice of register,
 * neither of which a fixed MusicXML of the printed (C major only) edition can
 * offer.
 *
 * `figure` holds offsets in **scale degrees** (not semitones) from the
 * measure's root, and the root itself is a scale-degree index where 0 is the
 * tonic (C4 in the printed C major original). Each measure is
 * `HANON_NOTES_PER_MEASURE` sixteenths in 2/4; the piece ends on a single
 * tonic. The left hand doubles the right exactly one octave below throughout.
 *
 * Most exercises are two segments (up, then down). The extra one-measure
 * segments are real irregularities in the original: Hanon alters the figure's
 * last note or two at each turnaround so the hand lands where the next
 * direction needs it.
 *
 * Provenance: derived from the note content of the exercises themselves, and
 * cross-checked note-for-note against two independent public sources that
 * agree exactly -- the pattern definitions in bluekeyes/hanon
 * (hanon/data/exercises.json, exercises 1-6) and reference MIDI renderings of
 * 1-20 in yogibooboo/Hanon_Test. The figures below reproduce those renderings
 * exactly; `hanonGenerator.test.ts` pins the ones that were checked by hand.
 */

export interface HanonSegment {
  /** Scale-degree offsets from this measure's root, one per note. */
  figure: number[]
  /** First and last root of the run, inclusive; the root steps by one degree. */
  rootFrom: number
  rootTo: number
}

export interface HanonPattern {
  number: number
  segments: HanonSegment[]
}

export const HANON_NOTES_PER_MEASURE = 8

/** Every exercise closes on a single tonic, held for the whole final measure. */
export const HANON_FINAL_NOTE_INDEX = 0

export const HANON_PATTERNS: HanonPattern[] = [
  {
    number: 1,
    segments: [
      { figure: [0, 2, 3, 4, 5, 4, 3, 2], rootFrom: 0, rootTo: 13 },
      { figure: [0, -2, -3, -4, -5, -4, -3, -2], rootFrom: 18, rootTo: 4 },
    ],
  },
  {
    number: 2,
    segments: [
      { figure: [0, 2, 5, 4, 3, 4, 3, 2], rootFrom: 0, rootTo: 13 },
      { figure: [0, -3, -5, -4, -3, -4, -3, -2], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 3,
    segments: [
      { figure: [0, 2, 5, 4, 3, 2, 3, 4], rootFrom: 0, rootTo: 13 },
      { figure: [0, -3, -5, -4, -3, -2, -3, -4], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 4,
    segments: [
      { figure: [0, 1, 0, 2, 5, 4, 3, 2], rootFrom: 0, rootTo: 13 },
      { figure: [0, -1, 0, -3, -5, -4, -3, -2], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 5,
    segments: [
      { figure: [0, 5, 4, 5, 3, 4, 2, 3], rootFrom: 0, rootTo: 13 },
      { figure: [0, 1, 0, 2, 1, 3, 2, 4], rootFrom: 14, rootTo: 1 },
    ],
  },
  {
    number: 6,
    segments: [
      { figure: [0, 5, 4, 5, 3, 5, 2, 5], rootFrom: 0, rootTo: 12 },
      { figure: [0, 5, 4, 5, 3, 5, 2, 1], rootFrom: 13, rootTo: 13 },
      { figure: [0, -5, -4, -5, -3, -5, -2, -5], rootFrom: 18, rootTo: 6 },
      { figure: [0, -5, -4, -5, -3, -5, -2, -3], rootFrom: 5, rootTo: 5 },
    ],
  },
  {
    number: 7,
    segments: [
      { figure: [0, 2, 1, 3, 2, 4, 3, 2], rootFrom: 0, rootTo: 13 },
      { figure: [0, -2, -1, -3, -2, -4, -3, -2], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 8,
    segments: [
      { figure: [0, 2, 4, 5, 3, 4, 2, 3], rootFrom: 0, rootTo: 13 },
      { figure: [0, -2, -4, -5, -3, -4, -2, -3], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 9,
    segments: [
      { figure: [0, 2, 3, 2, 4, 3, 5, 4], rootFrom: 0, rootTo: 13 },
      { figure: [0, -2, -3, -2, -4, -3, -5, -4], rootFrom: 18, rootTo: 6 },
      { figure: [0, -2, -3, -2, -4, -3, -4, -3], rootFrom: 5, rootTo: 5 },
    ],
  },
  {
    number: 10,
    segments: [
      { figure: [0, 5, 4, 3, 2, 3, 2, 3], rootFrom: 0, rootTo: 13 },
      { figure: [0, -5, -4, -3, -2, -3, -2, -3], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 11,
    segments: [
      { figure: [0, 2, 5, 4, 5, 4, 3, 4], rootFrom: 0, rootTo: 13 },
      { figure: [0, -3, -5, -4, -5, -4, -3, -4], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 12,
    segments: [
      { figure: [0, -4, -2, -3, -4, -3, -2, -4], rootFrom: 4, rootTo: 4 },
      { figure: [0, -5, -3, -4, -5, -4, -3, -5], rootFrom: 6, rootTo: 17 },
      { figure: [0, -5, -3, -4, -5, -4, -3, -2], rootFrom: 18, rootTo: 18 },
      { figure: [0, 5, 3, 4, 5, 4, 3, 5], rootFrom: 13, rootTo: 0 },
      { figure: [0, 4, 2, 3, 4, 3, 2, 3], rootFrom: 0, rootTo: 0 },
    ],
  },
  {
    number: 13,
    segments: [
      { figure: [0, -2, 1, -1, 2, 0, 1, 2], rootFrom: 2, rootTo: 15 },
      { figure: [0, 2, -1, 1, 0, -2, -1, 0], rootFrom: 16, rootTo: 3 },
    ],
  },
  {
    number: 14,
    segments: [
      { figure: [0, 1, 3, 2, 3, 2, 4, 3], rootFrom: 0, rootTo: 13 },
      { figure: [0, -1, -3, -2, -3, -2, -4, -3], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 15,
    segments: [
      { figure: [0, 2, 1, 3, 2, 4, 3, 5], rootFrom: 0, rootTo: 12 },
      { figure: [0, 2, 1, 3, 2, 4, 3, 4], rootFrom: 13, rootTo: 13 },
      { figure: [0, -2, -1, -3, -2, -4, -3, -5], rootFrom: 18, rootTo: 6 },
      { figure: [0, -2, -1, -3, -2, -4, -3, -4], rootFrom: 5, rootTo: 5 },
    ],
  },
  {
    number: 16,
    segments: [
      { figure: [0, 2, 1, 2, 5, 4, 3, 4], rootFrom: 0, rootTo: 13 },
      { figure: [0, -3, -2, -3, -5, -4, -3, -4], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 17,
    segments: [
      { figure: [0, 2, 5, 4, 6, 5, 4, 5], rootFrom: 0, rootTo: 12 },
      { figure: [0, 2, 5, 4, 6, 5, 4, 3], rootFrom: 13, rootTo: 13 },
      { figure: [0, -3, -5, -4, -6, -5, -4, -6], rootFrom: 18, rootTo: 7 },
      { figure: [0, -3, -5, -4, -6, -5, -4, -5], rootFrom: 6, rootTo: 6 },
    ],
  },
  {
    number: 18,
    segments: [
      { figure: [0, 1, 3, 2, 4, 3, 1, 2], rootFrom: 0, rootTo: 13 },
      { figure: [0, -1, -3, -2, -4, -3, -1, -2], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 19,
    segments: [
      { figure: [0, 5, 3, 4, 5, 3, 2, 4], rootFrom: 0, rootTo: 13 },
      { figure: [0, -5, -3, -4, -5, -3, -2, -4], rootFrom: 18, rootTo: 5 },
    ],
  },
  {
    number: 20,
    segments: [
      { figure: [0, 2, 5, 7, 5, 4, 5, 3], rootFrom: -5, rootTo: 8 },
      { figure: [0, 2, 5, 7, 5, 4, 5, 2], rootFrom: 9, rootTo: 9 },
      { figure: [0, -2, -5, -7, -5, -6, -5, -7], rootFrom: 16, rootTo: 3 },
      { figure: [0, -2, -5, -7, -5, -6, -5, -6], rootFrom: 2, rootTo: 2 },
    ],
  },
]

export const HANON_EXERCISE_NUMBERS = HANON_PATTERNS.map((pattern) => pattern.number)

export function hanonPattern(exerciseNumber: number): HanonPattern {
  return HANON_PATTERNS.find((pattern) => pattern.number === exerciseNumber) ?? HANON_PATTERNS[0]
}

/**
 * The measures a segment covers, in order. Roots step by one degree towards
 * `rootTo`, so a single-measure segment (`rootFrom === rootTo`) yields one root.
 */
export function segmentRoots(segment: HanonSegment): number[] {
  const step = segment.rootTo >= segment.rootFrom ? 1 : -1
  const roots: number[] = []
  for (let root = segment.rootFrom; root !== segment.rootTo + step; root += step) {
    roots.push(root)
  }
  return roots
}

/**
 * Where the descending half starts. Hanon turns around exactly once, so the
 * ascending half is every segment before the first one whose root walks
 * downwards; single-measure turnaround segments belong to the half they follow.
 */
export function descendingSegmentIndex(pattern: HanonPattern): number {
  const index = pattern.segments.findIndex((segment) => segment.rootTo < segment.rootFrom)
  return index === -1 ? pattern.segments.length : index
}
