import type { CreatedExercise, HanonSettings, TrainingHandMode } from '../types/training'
import {
  accidentalsLabel,
  asMusicXmlPitch,
  createMusicXmlFile,
  findKey,
  xmlEscape,
  xmlOctave,
} from './musicKeys'
import type { KeyConfig, Pitch } from './musicKeys'
import {
  descendingSegmentIndex,
  hanonPattern,
  HANON_FINAL_NOTE_INDEX,
  HANON_NOTES_PER_MEASURE,
  segmentRoots,
} from './hanonPatterns'

/**
 * Builds Hanon Part 1 (exercises 1-20) as an in-memory MusicXML file, from the
 * degree-offset rules in `hanonPatterns.ts`. Unlike `trainingGenerator.ts`
 * there is no randomness here at all: the same settings always produce the
 * same score, because the exercise is a fixed piece of 1873 pedagogy and not
 * something we are inventing.
 */

/** Sixteenths in 2/4: divisions per quarter, so one measure is 8 divisions. */
const DIVISIONS_PER_QUARTER = 4
const DIVISIONS_PER_MEASURE = HANON_NOTES_PER_MEASURE

/** Scale degrees per octave -- the unit `HanonSegment.figure` offsets are in. */
const DEGREES_PER_OCTAVE = 7

/** The printed original puts the right hand's tonic at C4; the left hand doubles an octave below. */
const BASE_OCTAVE = 4
const LEFT_HAND_OCTAVE_OFFSET = -DEGREES_PER_OCTAVE

const LOWEST_PLAYABLE_MIDI = 21
const HIGHEST_PLAYABLE_MIDI = 108

const DEFAULT_SETTINGS: HanonSettings = {
  exerciseNumber: 1,
  handMode: 'both',
  key: 'C',
  octaveShift: 0,
  length: 'full',
}

export interface CreatedHanonExercise extends CreatedExercise {
  exerciseNumber: number
  measureCount: number
  lowestMidi: number
  highestMidi: number
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function sanitizeHanonSettings(settings: Partial<HanonSettings>): HanonSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return {
    ...merged,
    exerciseNumber: clamp(Math.round(merged.exerciseNumber), 1, 20),
    octaveShift: clamp(Math.round(merged.octaveShift), -2, 2),
  }
}

function keyFor(settings: HanonSettings): KeyConfig {
  // Hanon Part 1 is entirely diatonic, so only the major keys make sense here.
  return findKey(settings.key, 'major') ?? findKey('C', 'major')!
}

/**
 * A scale-degree index (0 = tonic) as a spelled pitch. Reads the step/alter out
 * of the key so a transposed exercise is notated correctly (index 3 in B-flat
 * major is E-flat, not D-sharp) rather than being reconstructed from semitones.
 */
function pitchAtDegreeIndex(key: KeyConfig, index: number, octaveShift: number): Pitch {
  const degree = ((index % DEGREES_PER_OCTAVE) + DEGREES_PER_OCTAVE) % DEGREES_PER_OCTAVE
  const octaveOffset = Math.floor(index / DEGREES_PER_OCTAVE) + octaveShift
  const scalePitch = key.scale[degree]
  const tonicPc = key.scale[0].pc
  const tonicMidi = 12 * (BASE_OCTAVE + 1) + tonicPc
  const semitonesAboveTonic = ((scalePitch.pc - tonicPc) % 12 + 12) % 12
  const midi = tonicMidi + semitonesAboveTonic + 12 * octaveOffset
  return { ...scalePitch, midi, octave: xmlOctave(midi) }
}

/**
 * The right hand's degree indices, measure by measure. The left hand is the
 * same list an octave lower, so only one line ever needs generating.
 */
export function hanonMeasures(settings: HanonSettings): number[][] {
  const pattern = hanonPattern(settings.exerciseNumber)
  const segments =
    settings.length === 'ascending'
      ? pattern.segments.slice(0, descendingSegmentIndex(pattern))
      : pattern.segments

  const measures = segments.flatMap((segment) =>
    segmentRoots(segment).map((root) => segment.figure.map((offset) => root + offset)),
  )
  return [...measures, [HANON_FINAL_NOTE_INDEX]]
}

/** The exercise as MIDI numbers for one hand, in playing order. */
export function hanonMidiNotes(
  partialSettings: Partial<HanonSettings>,
  hand: 'right' | 'left' = 'right',
): number[] {
  const settings = sanitizeHanonSettings(partialSettings)
  const key = keyFor(settings)
  const handOffset = hand === 'left' ? LEFT_HAND_OCTAVE_OFFSET : 0
  return hanonMeasures(settings)
    .flat()
    .map((index) => pitchAtDegreeIndex(key, index + handOffset, settings.octaveShift).midi)
}

function noteXml(
  pitch: Pitch,
  staff: 1 | 2,
  voice: 1 | 2,
  positionInMeasure: number,
  isFinalMeasure: boolean,
): string {
  if (isFinalMeasure) {
    return `      <note>
        ${asMusicXmlPitch(pitch)}
        <duration>${DIVISIONS_PER_MEASURE}</duration>
        <voice>${voice}</voice>
        <type>half</type>
        <staff>${staff}</staff>
      </note>`
  }

  // Beam the sixteenths in groups of four (one per quarter). Without explicit
  // beams OSMD draws eight separate flags, which is unreadable at speed.
  const positionInGroup = positionInMeasure % DIVISIONS_PER_QUARTER
  const beam = positionInGroup === 0 ? 'begin' : positionInGroup === DIVISIONS_PER_QUARTER - 1 ? 'end' : 'continue'
  return `      <note>
        ${asMusicXmlPitch(pitch)}
        <duration>1</duration>
        <voice>${voice}</voice>
        <type>16th</type>
        <staff>${staff}</staff>
        <beam number="1">${beam}</beam>
        <beam number="2">${beam}</beam>
      </note>`
}

function attributesXml(key: KeyConfig, handMode: TrainingHandMode): string {
  const clefs =
    handMode === 'both'
      ? `        <staves>2</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
        <clef number="2">
          <sign>F</sign>
          <line>4</line>
        </clef>`
      : `        <clef>
          <sign>${handMode === 'left' ? 'F' : 'G'}</sign>
          <line>${handMode === 'left' ? 4 : 2}</line>
        </clef>`

  return `      <attributes>
        <divisions>${DIVISIONS_PER_QUARTER}</divisions>
        <key>
          <fifths>${key.fifths}</fifths>
        </key>
        <time>
          <beats>2</beats>
          <beat-type>4</beat-type>
        </time>
${clefs}
      </attributes>`
}

function measureXml(
  measureNumber: number,
  degreeIndices: number[],
  key: KeyConfig,
  settings: HanonSettings,
  isFinalMeasure: boolean,
): string {
  const attributes = measureNumber === 1 ? `\n${attributesXml(key, settings.handMode)}` : ''
  const line = (staff: 1 | 2, voice: 1 | 2, octaveShift: number) =>
    degreeIndices
      .map((index, position) =>
        noteXml(
          pitchAtDegreeIndex(key, index + octaveShift, settings.octaveShift),
          staff,
          voice,
          position,
          isFinalMeasure,
        ),
      )
      .join('\n')

  if (settings.handMode === 'both') {
    return `    <measure number="${measureNumber}">${attributes}
${line(1, 1, 0)}
      <backup>
        <duration>${DIVISIONS_PER_MEASURE}</duration>
      </backup>
${line(2, 2, LEFT_HAND_OCTAVE_OFFSET)}
    </measure>`
  }

  return `    <measure number="${measureNumber}">${attributes}
${line(1, 1, settings.handMode === 'left' ? LEFT_HAND_OCTAVE_OFFSET : 0)}
    </measure>`
}

function titleFor(settings: HanonSettings, key: KeyConfig): string {
  const suffix = settings.length === 'ascending' ? ' (ascending)' : ''
  return `Hanon No. ${settings.exerciseNumber} - ${key.name}${suffix}`
}

export function generateHanonMusicXml(partialSettings: Partial<HanonSettings> = {}): string {
  const settings = sanitizeHanonSettings(partialSettings)
  const key = keyFor(settings)
  const measures = hanonMeasures(settings)

  const body = measures
    .map((degreeIndices, index) =>
      measureXml(index + 1, degreeIndices, key, settings, index === measures.length - 1),
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${xmlEscape(titleFor(settings, key))}</work-title>
  </work>
  <identification>
    <creator type="composer">C. L. Hanon</creator>
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

/**
 * The MIDI range the exercise will actually occupy, so the setup screen can
 * show it and refuse a shift that would run off the end of a piano.
 */
export function hanonMidiRange(partialSettings: Partial<HanonSettings> = {}): { low: number; high: number } {
  const settings = sanitizeHanonSettings(partialSettings)
  const key = keyFor(settings)
  const lowestOffset = settings.handMode === 'right' ? 0 : LEFT_HAND_OCTAVE_OFFSET
  const highestOffset = settings.handMode === 'left' ? LEFT_HAND_OCTAVE_OFFSET : 0
  const indices = hanonMeasures(settings).flat()
  return {
    low: Math.min(...indices.map((index) => pitchAtDegreeIndex(key, index + lowestOffset, settings.octaveShift).midi)),
    high: Math.max(...indices.map((index) => pitchAtDegreeIndex(key, index + highestOffset, settings.octaveShift).midi)),
  }
}

export function isHanonRangePlayable(partialSettings: Partial<HanonSettings> = {}): boolean {
  const range = hanonMidiRange(partialSettings)
  return range.low >= LOWEST_PLAYABLE_MIDI && range.high <= HIGHEST_PLAYABLE_MIDI
}

export function createHanonExercise(settings: Partial<HanonSettings>): CreatedHanonExercise {
  const sanitized = sanitizeHanonSettings(settings)
  const key = keyFor(sanitized)
  const range = hanonMidiRange(sanitized)
  return {
    file: createMusicXmlFile(generateHanonMusicXml(sanitized), `hanon-${sanitized.exerciseNumber}`),
    keyName: key.name,
    tonicPitchClass: key.scale[0].pc,
    accidentalsLabel: accidentalsLabel(key),
    exerciseNumber: sanitized.exerciseNumber,
    measureCount: hanonMeasures(sanitized).length,
    lowestMidi: range.low,
    highestMidi: range.high,
  }
}

export function createHanonExerciseFile(settings: Partial<HanonSettings>): File {
  return createHanonExercise(settings).file
}
