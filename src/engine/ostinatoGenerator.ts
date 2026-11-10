/**
 * Hand-independence drill: the left hand repeats one figure (an ostinato) over
 * a chord progression while the right hand plays a generated melody on top.
 *
 * It is played in the ordinary Wait Mode, and that is enough to be useful: the
 * cursor walks every position where EITHER hand strikes, so the drill teaches
 * where each melody note falls against the bass -- which one comes first, which
 * ones land together, which ones fall between two bass notes. That is the part
 * of a two-rhythm passage that has to be worked out slowly before it can ever
 * be played in tempo.
 *
 * Three decisions worth knowing before touching it:
 *
 * - **Each figure brings its own progression** (`PATTERNS`): the boogie bass
 *   only makes sense over a twelve-bar blues, the Alberti bass over a classical
 *   I-IV-V-I. A free choice of progression would mostly produce combinations
 *   nobody plays.
 * - **The figure is written once, in steps from the chord's root**, both as a
 *   diatonic offset (which letter) and, where it leaves the key, as semitones
 *   (which pitch): the boogie's flat seventh is the seventh LETTER above the
 *   root lowered to sit ten semitones up, so B♭ over C, E♭ over F, F natural
 *   over G, spelled correctly in every key.
 * - **The melody is built from rhythm cells that never cross a beat they would
 *   need a tie for**, and beams are written explicitly per beat: OSMD does not
 *   beam on its own (see `hanonGenerator.ts`). The test suite sums every
 *   measure, since a measure that does not add up renders wrong without an
 *   error.
 */
import type { CreatedExercise, OstinatoMelodyRhythm, OstinatoPattern, OstinatoSettings } from '../types/training'
import {
  accidentalsLabel,
  asMusicXmlPitch,
  buildScalePitches,
  createMusicXmlFile,
  createSeededRng,
  findKey,
  keySignatureAlter,
  KEYS,
  RANDOM_KEY,
  TRAINING_KEY_NAMES,
  xmlEscape,
  xmlOctave,
} from './musicKeys'
import type { KeyConfig, Pitch } from './musicKeys'

/** Sixteenths: the shortest value written is the sixteenth of a dotted pair. */
const DIVISIONS = 4
const MEASURE = 4 * DIVISIONS

const DEFAULT_SETTINGS: OstinatoSettings = {
  pattern: 'alberti',
  melodyRhythm: 'easy',
  key: 'C',
  measureCount: 8,
}

/** The right hand's melody stays on the treble staff, ledger lines kept to a minimum. */
const MELODY_LOW = 60
const MELODY_HIGH = 79

/** One note of the left-hand figure, relative to the chord's root. */
interface FigureNote {
  /** Letters above the root (0 = the root itself, 4 = its fifth, 7 = its octave). */
  degree: number
  /** Semitones above the root, only where the note leaves the key. */
  semitones?: number
  duration: number
}

interface PatternDefinition {
  label: string
  figure: FigureNote[]
  /** Chord roots as scale-degree indices from the tonic, one per measure, looped. */
  progression: number[]
}

const eighths = (degrees: number[], semitones: (number | undefined)[] = []): FigureNote[] =>
  degrees.map((degree, index) => ({ degree, semitones: semitones[index], duration: 2 }))

const BOOGIE_DEGREES = [0, 2, 4, 5, 6, 5, 4, 2]
// Dominant-seventh walk: root, major third, fifth, sixth, flat seventh.
const BOOGIE_SEMITONES = [0, 4, 7, 9, 10, 9, 7, 4]
const TWELVE_BAR_BLUES = [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 0]

export const OSTINATO_PATTERNS: Record<OstinatoPattern, PatternDefinition> = {
  fifths: {
    label: 'Fifths in quarters',
    figure: [0, 4, 7, 4].map((degree) => ({ degree, duration: 4 })),
    // I V vi IV, the progression of half the pop songs ever written.
    progression: [0, 4, 5, 3],
  },
  alberti: {
    label: 'Alberti bass',
    figure: eighths([0, 4, 2, 4, 0, 4, 2, 4]),
    progression: [0, 3, 4, 0],
  },
  boogie: {
    label: 'Boogie-woogie, straight',
    figure: eighths(BOOGIE_DEGREES, BOOGIE_SEMITONES),
    progression: TWELVE_BAR_BLUES,
  },
  boogieDotted: {
    label: 'Boogie-woogie, long-short',
    figure: BOOGIE_DEGREES.map((degree, index) => ({
      degree,
      semitones: BOOGIE_SEMITONES[index],
      duration: index % 2 === 0 ? 3 : 1,
    })),
    progression: TWELVE_BAR_BLUES,
  },
}

export const OSTINATO_PATTERN_ORDER: OstinatoPattern[] = ['fifths', 'alberti', 'boogie', 'boogieDotted']

/**
 * The melody's rhythm cells, in sixteenths; a negative value is a rest.
 * One-beat cells may go anywhere, two-beat cells only on beat 1 or 3, so no
 * note ever crosses the middle of the measure and none needs a tie.
 */
const RHYTHM_CELLS: Record<OstinatoMelodyRhythm, { beat: number[][]; twoBeats: number[][]; whole: boolean }> = {
  easy: { beat: [[4]], twoBeats: [[8], [8], [4, 4]], whole: true },
  medium: { beat: [[4], [4], [2, 2]], twoBeats: [[8], [6, 2]], whole: false },
  hard: {
    beat: [[2, 2], [3, 1], [-2, 2], [4]],
    twoBeats: [[6, 2], [2, 4, 2], [-2, 6]],
    whole: false,
  },
}

/** What a note is written as, from its length in sixteenths. */
const NOTE_TYPES: Record<number, { type: string; dotted: boolean }> = {
  1: { type: '16th', dotted: false },
  2: { type: 'eighth', dotted: false },
  3: { type: 'eighth', dotted: true },
  4: { type: 'quarter', dotted: false },
  6: { type: 'quarter', dotted: true },
  8: { type: 'half', dotted: false },
  12: { type: 'half', dotted: true },
  16: { type: 'whole', dotted: false },
}

/** One written note or rest of one staff. */
interface StaffEvent {
  pitch: Pitch | null
  duration: number
}

function sanitize(settings: Partial<OstinatoSettings>): OstinatoSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return {
    ...merged,
    pattern: merged.pattern in OSTINATO_PATTERNS ? merged.pattern : DEFAULT_SETTINGS.pattern,
    measureCount: Math.min(48, Math.max(4, Math.round(merged.measureCount))),
  }
}

export function resolveKey(name: string, rng: () => number): KeyConfig {
  const tonic =
    name === RANDOM_KEY ? TRAINING_KEY_NAMES[Math.floor(rng() * TRAINING_KEY_NAMES.length)] : name
  return findKey(tonic, 'major') ?? KEYS[0]
}

/**
 * The left hand's tonic: the one between G2 and F♯3, so every figure (the boogie
 * climbs a seventh above its root) stays on the bass staff in every key.
 */
export function bassTonicMidi(key: KeyConfig): number {
  const pc = key.scale[0].pc
  return pc <= 6 ? 48 + pc : 36 + pc
}

/** A scale-degree index from the tonic (any integer) as a spelled pitch above `tonicMidi`. */
export function pitchAtDegree(key: KeyConfig, tonicMidi: number, index: number): Pitch {
  const degree = ((index % 7) + 7) % 7
  const octaves = Math.floor(index / 7)
  const scalePitch = key.scale[degree]
  const above = (((scalePitch.pc - key.scale[0].pc) % 12) + 12) % 12
  const midi = tonicMidi + above + 12 * octaves
  return { ...scalePitch, midi, octave: xmlOctave(midi) }
}

/**
 * The window the whole left-hand figure must fit in: E2 to E4, one ledger
 * line under the bass staff to the C4 ledger line and a step past it.
 */
const BASS_WINDOW = { low: 40, high: 64 }

function figurePitchAt(key: KeyConfig, root: number, note: FigureNote): Pitch {
  const tonicMidi = bassTonicMidi(key)
  const diatonic = pitchAtDegree(key, tonicMidi, root + note.degree)
  if (note.semitones === undefined) {
    return diatonic
  }
  const target = pitchAtDegree(key, tonicMidi, root).midi + note.semitones
  const delta = target - diatonic.midi
  return { ...diatonic, midi: target, alter: (diatonic.alter ?? 0) + delta }
}

/**
 * The root of a chord on the left hand, as a degree index from the bass tonic:
 * the chord's own degree or the same one an octave down. The figure has to fit
 * the bass window, and among the placements that do, the one nearest the tonic
 * wins, which keeps the bass in one hand position as a real bass line would (V
 * and vi usually go below the tonic, IV above).
 */
function rootIndex(key: KeyConfig, chordDegree: number, pattern: PatternDefinition): number {
  const overflow = (root: number) => {
    const midis = pattern.figure.map((note) => figurePitchAt(key, root, note).midi)
    return Math.max(0, BASS_WINDOW.low - Math.min(...midis)) + Math.max(0, Math.max(...midis) - BASS_WINDOW.high)
  }
  const candidates = [chordDegree, chordDegree - 7]
  return candidates.reduce((best, root) => {
    const a = overflow(root)
    const b = overflow(best)
    return a < b || (a === b && Math.abs(root) < Math.abs(best)) ? root : best
  })
}

function bassMeasure(key: KeyConfig, chordDegree: number, pattern: PatternDefinition): StaffEvent[] {
  const root = rootIndex(key, chordDegree, pattern)
  return pattern.figure.map((note) => ({ pitch: figurePitchAt(key, root, note), duration: note.duration }))
}

/** Pitch classes of the triad on a scale degree, which the melody leans on at strong beats. */
function triadPitchClasses(key: KeyConfig, chordDegree: number): Set<number> {
  return new Set([0, 2, 4].map((offset) => key.scale[(chordDegree + offset) % 7].pc))
}

function measureRhythm(rhythm: OstinatoMelodyRhythm, rng: () => number): number[] {
  const cells = RHYTHM_CELLS[rhythm]
  if (cells.whole && rng() < 0.2) {
    return [16]
  }
  const durations: number[] = []
  let beat = 0
  while (beat < 4) {
    const canTakeTwo = beat % 2 === 0
    if (canTakeTwo && rng() < 0.5) {
      durations.push(...cells.twoBeats[Math.floor(rng() * cells.twoBeats.length)])
      beat += 2
    } else {
      durations.push(...cells.beat[Math.floor(rng() * cells.beat.length)])
      beat += 1
    }
  }
  return durations
}

/**
 * The right hand: a random walk over the key's scale, landing on a chord tone
 * at the start of every half measure (where the harmony is heard) and moving
 * mostly by step in between, so the melody reads like one rather than like a
 * string of leaps.
 */
function melodyMeasure(
  scale: Pitch[],
  chordPcs: Set<number>,
  rhythm: number[],
  state: { index: number },
  rng: () => number,
): StaffEvent[] {
  const events: StaffEvent[] = []
  let position = 0
  for (const value of rhythm) {
    const duration = Math.abs(value)
    if (value < 0) {
      events.push({ pitch: null, duration })
      position += duration
      continue
    }
    if (position % (MEASURE / 2) === 0) {
      // The chord tone nearest the current position.
      let best = state.index
      let bestDistance = Number.POSITIVE_INFINITY
      scale.forEach((pitch, index) => {
        const distance = Math.abs(index - state.index) + rng() * 0.5
        if (chordPcs.has(((pitch.midi % 12) + 12) % 12) && distance < bestDistance) {
          best = index
          bestDistance = distance
        }
      })
      state.index = best
    } else {
      const step = rng() < 0.75 ? 1 : 2
      const direction = rng() < 0.5 ? -1 : 1
      let next = state.index + step * direction
      if (next < 0 || next >= scale.length) {
        next = state.index - step * direction
      }
      state.index = next
    }
    events.push({ pitch: scale[state.index], duration })
    position += duration
  }
  return events
}

const ACCIDENTAL_NAMES: Record<number, string> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
}

/**
 * One staff's notes for one measure. Sign printing follows the written rule:
 * a note shows an accidental when it departs from what the key signature, or
 * an earlier sign on the same line or space in this measure, already says.
 */
function staffXml(events: StaffEvent[], staff: 1 | 2, fifths: number): string {
  const inForce = new Map<string, number>()
  let position = 0
  // Beam groups: every note shorter than a quarter that sits inside one beat
  // is beamed with the others of that beat, when there are at least two.
  const beatOf = (start: number, duration: number) => {
    const beat = Math.floor(start / DIVISIONS)
    return duration < DIVISIONS && start + duration <= (beat + 1) * DIVISIONS ? beat : -1
  }
  const starts: number[] = []
  for (const event of events) {
    starts.push(position)
    position += event.duration
  }
  const groups = new Map<number, number[]>()
  events.forEach((event, index) => {
    const beat = beatOf(starts[index], event.duration)
    if (event.pitch && beat >= 0) {
      groups.set(beat, [...(groups.get(beat) ?? []), index])
    }
  })

  return events
    .map((event, index) => {
      const written = NOTE_TYPES[event.duration]
      const dot = written.dotted ? '\n        <dot/>' : ''
      if (!event.pitch) {
        return `      <note>
        <rest/>
        <duration>${event.duration}</duration>
        <voice>${staff}</voice>
        <type>${written.type}</type>${dot}
        <staff>${staff}</staff>
      </note>`
      }
      const pitch = event.pitch
      const alter = pitch.alter ?? 0
      const place = `${pitch.step}${pitch.octave}`
      const current = inForce.get(place) ?? keySignatureAlter(fifths, pitch.step)
      const accidental = alter !== current ? `\n        <accidental>${ACCIDENTAL_NAMES[alter]}</accidental>` : ''
      inForce.set(place, alter)

      let beams = ''
      const group = groups.get(beatOf(starts[index], event.duration))
      if (group && group.length >= 2) {
        const at = group.indexOf(index)
        const level1 = at === 0 ? 'begin' : at === group.length - 1 ? 'end' : 'continue'
        beams = `\n        <beam number="1">${level1}</beam>`
        if (event.duration === 1) {
          // The sixteenth of a dotted pair: a hook pointing back at its partner.
          beams += `\n        <beam number="2">${at === 0 ? 'forward hook' : 'backward hook'}</beam>`
        }
      }
      return `      <note>
        ${asMusicXmlPitch({ ...pitch, alter: alter || undefined })}
        <duration>${event.duration}</duration>
        <voice>${staff}</voice>
        <type>${written.type}</type>${dot}${accidental}
        <staff>${staff}</staff>${beams}
      </note>`
    })
    .join('\n')
}

function attributesXml(fifths: number): string {
  return `      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key>
          <fifths>${fifths}</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>2</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
        <clef number="2">
          <sign>F</sign>
          <line>4</line>
        </clef>
      </attributes>`
}

export interface OstinatoMeasure {
  chordDegree: number
  right: StaffEvent[]
  left: StaffEvent[]
}

export interface CreatedOstinatoExercise extends CreatedExercise {
  measures: OstinatoMeasure[]
}

/** The whole exercise as data, so the tests can check it without parsing XML. */
export function ostinatoMeasures(
  settings: OstinatoSettings,
  key: KeyConfig,
  rng: () => number,
): OstinatoMeasure[] {
  const pattern = OSTINATO_PATTERNS[settings.pattern]
  const scale = buildScalePitches(key, MELODY_LOW, MELODY_HIGH)
  // Start the melody on the tonic nearest the middle of its range.
  const tonicPc = key.scale[0].pc
  const middle = (MELODY_LOW + MELODY_HIGH) / 2
  const state = {
    index: scale.reduce(
      (best, pitch, index) =>
        pitch.midi % 12 === tonicPc && Math.abs(pitch.midi - middle) < Math.abs(scale[best].midi - middle)
          ? index
          : best,
      0,
    ),
  }
  const measures: OstinatoMeasure[] = []
  for (let i = 0; i < settings.measureCount - 1; i += 1) {
    const chordDegree = pattern.progression[i % pattern.progression.length]
    measures.push({
      chordDegree,
      left: bassMeasure(key, chordDegree, pattern),
      right: melodyMeasure(
        scale,
        triadPitchClasses(key, chordDegree),
        measureRhythm(settings.melodyRhythm, rng),
        state,
        rng,
      ),
    })
  }
  // The close: both hands on the tonic, held for the whole measure.
  const melodyTonic = scale.reduce(
    (best, pitch) =>
      pitch.midi % 12 === tonicPc && Math.abs(pitch.midi - scale[state.index].midi) < Math.abs(best.midi - scale[state.index].midi)
        ? pitch
        : best,
    scale.find((pitch) => pitch.midi % 12 === tonicPc) ?? scale[0],
  )
  measures.push({
    chordDegree: 0,
    left: [{ pitch: pitchAtDegree(key, bassTonicMidi(key), 0), duration: MEASURE }],
    right: [{ pitch: melodyTonic, duration: MEASURE }],
  })
  return measures
}

function generateXml(measures: OstinatoMeasure[], key: KeyConfig, title: string): string {
  const body = measures
    .map(
      (measure, index) => `    <measure number="${index + 1}">${index === 0 ? `\n${attributesXml(key.fifths)}` : ''}
${staffXml(measure.right, 1, key.fifths)}
      <backup>
        <duration>${MEASURE}</duration>
      </backup>
${staffXml(measure.left, 2, key.fifths)}
    </measure>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${xmlEscape(title)}</work-title>
  </work>
  <identification>
    <creator type="composer">Piano Trainer</creator>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${body}
  </part>
</score-partwise>
`
}

export function createOstinatoExercise(
  partialSettings: Partial<OstinatoSettings>,
  seed: string,
): CreatedOstinatoExercise {
  const settings = sanitize(partialSettings)
  const rng = createSeededRng(seed)
  const key = resolveKey(settings.key, rng)
  const measures = ostinatoMeasures(settings, key, rng)
  const title = `${OSTINATO_PATTERNS[settings.pattern].label} - ${key.name}`
  return {
    file: createMusicXmlFile(generateXml(measures, key, title), `ostinato-${settings.pattern}`),
    keyName: key.name,
    tonicPitchClass: key.scale[0].pc,
    accidentalsLabel: accidentalsLabel(key),
    measures,
  }
}
