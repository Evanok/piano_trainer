/**
 * Polyrhythm drill: within every beat, one hand plays N even notes while the
 * other plays M (3 against 2, 3 against 4, and the same with the hands
 * swapped).
 *
 * Like the ostinato drill it is played in the ordinary Wait Mode, which is
 * exactly how a polyrhythm is learnt before it is played in tempo: the cursor
 * stops on every note of EITHER hand, in the order they fall, so 3 against 2
 * is walked as "together, right, left, right" -- the composite rhythm the two
 * hands have to make between them. Nothing here is random except the key: the
 * difficulty is the ratio itself, and a melody would only distract from it.
 *
 * Notation: `<divisions>12</divisions>` (a quarter is 12), so an eighth is 6, a
 * triplet eighth 4 and a sixteenth 3, all whole numbers. A triplet carries
 * `<time-modification>` (3 in the time of 2) and a `<tuplet>` start/stop, and
 * every beat is beamed explicitly, since OSMD does not beam on its own (see
 * `hanonGenerator.ts`). The test suite sums every measure of both staves.
 *
 * Every note is a tone of a diatonic triad, so the key signature covers all of
 * them and no accidental is ever printed.
 */
import type { CreatedExercise, PolyrhythmPitches, PolyrhythmRatio, PolyrhythmSettings } from '../types/training'
import { accidentalsLabel, asMusicXmlPitch, createMusicXmlFile, createSeededRng, xmlEscape } from './musicKeys'
import type { KeyConfig, Pitch } from './musicKeys'
import { bassTonicMidi, pitchAtDegree, resolveKey } from './ostinatoGenerator'

/** Divisions per quarter: the smallest count both 3 and 4 (and 2) divide. */
const BEAT = 12
const MEASURE = 4 * BEAT

const DEFAULT_SETTINGS: PolyrhythmSettings = {
  ratio: '3:2',
  pitches: 'single',
  key: 'C',
  measureCount: 8,
}

export const POLYRHYTHM_RATIOS: Record<PolyrhythmRatio, { label: string; right: number; left: number }> = {
  '3:2': { label: '3 against 2 (right hand in triplets)', right: 3, left: 2 },
  '2:3': { label: '2 against 3 (left hand in triplets)', right: 2, left: 3 },
  '3:4': { label: '3 against 4 (right hand in triplets)', right: 3, left: 4 },
  '4:3': { label: '4 against 3 (left hand in triplets)', right: 4, left: 3 },
}

export const POLYRHYTHM_RATIO_ORDER: PolyrhythmRatio[] = ['3:2', '2:3', '3:4', '4:3']

/**
 * The order the hands strike in within one beat (the composite rhythm), as
 * the setup screen spells it out: 3 against 2 is together, right, left, right.
 */
export function compositeOrder(ratio: PolyrhythmRatio): Array<'together' | 'right' | 'left'> {
  const { right, left } = POLYRHYTHM_RATIOS[ratio]
  const rightStarts = new Set(Array.from({ length: right }, (_, index) => (index * BEAT) / right))
  const leftStarts = new Set(Array.from({ length: left }, (_, index) => (index * BEAT) / left))
  return [...new Set([...rightStarts, ...leftStarts])]
    .sort((a, b) => a - b)
    .map((start) =>
      rightStarts.has(start) && leftStarts.has(start) ? 'together' : rightStarts.has(start) ? 'right' : 'left',
    )
}

/** I IV V I, one chord per measure, looped. */
const PROGRESSION = [0, 3, 4, 0]

/**
 * The broken-chord figure of one beat, in letters above the chord's root,
 * for each count of notes per beat. Odd beats go up, even beats come back
 * down, so the hand rocks rather than jumping back at every beat.
 */
const BROKEN_FIGURES: Record<'right' | 'left', Record<number, number[]>> = {
  right: { 2: [0, 4], 3: [0, 2, 4], 4: [0, 2, 4, 2] },
  left: { 2: [0, 4], 3: [0, 4, 7], 4: [0, 4, 7, 4] },
}

/** The window each hand's notes must fit in: the treble staff to A5, the bass staff E2 to E4. */
const WINDOWS = {
  right: { low: 60, high: 81 },
  left: { low: 40, high: 64 },
}

const NOTE_TYPE_BY_COUNT: Record<number, string> = { 1: 'whole', 2: 'eighth', 3: 'eighth', 4: '16th' }

export interface PolyrhythmNote {
  pitch: Pitch
  duration: number
  /** Notes per beat in this hand, which decides how it is written; 1 for the final whole note. */
  perBeat: number
}

export interface PolyrhythmMeasure {
  chordDegree: number
  right: PolyrhythmNote[]
  left: PolyrhythmNote[]
}

export interface CreatedPolyrhythmExercise extends CreatedExercise {
  measures: PolyrhythmMeasure[]
}

function sanitize(settings: Partial<PolyrhythmSettings>): PolyrhythmSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return {
    ...merged,
    ratio: merged.ratio in POLYRHYTHM_RATIOS ? merged.ratio : DEFAULT_SETTINGS.ratio,
    pitches: merged.pitches === 'broken' ? 'broken' : 'single',
    measureCount: Math.min(48, Math.max(4, Math.round(merged.measureCount))),
  }
}

function handTonicMidi(key: KeyConfig, hand: 'right' | 'left'): number {
  return hand === 'right' ? 60 + key.scale[0].pc : bassTonicMidi(key)
}

function beatFigure(pitches: PolyrhythmPitches, hand: 'right' | 'left', count: number, beat: number): number[] {
  if (pitches === 'single') {
    return Array.from({ length: count }, () => 0)
  }
  const figure = BROKEN_FIGURES[hand][count]
  return beat % 2 === 0 ? figure : [...figure].reverse()
}

/**
 * The chord's root for one hand, as a degree index from that hand's tonic: the
 * chord's own degree or the same one an octave down, whichever keeps every
 * note in the hand's window, the one nearest the tonic when both do.
 */
function rootIndex(key: KeyConfig, hand: 'right' | 'left', chordDegree: number, degrees: number[]): number {
  const tonic = handTonicMidi(key, hand)
  const window = WINDOWS[hand]
  const overflow = (root: number) => {
    const midis = degrees.map((degree) => pitchAtDegree(key, tonic, root + degree).midi)
    return Math.max(0, window.low - Math.min(...midis)) + Math.max(0, Math.max(...midis) - window.high)
  }
  return [chordDegree, chordDegree - 7].reduce((best, root) => {
    const a = overflow(root)
    const b = overflow(best)
    return a < b || (a === b && Math.abs(root) < Math.abs(best)) ? root : best
  })
}

function handMeasure(
  key: KeyConfig,
  hand: 'right' | 'left',
  count: number,
  pitches: PolyrhythmPitches,
  chordDegree: number,
): PolyrhythmNote[] {
  const beats = [0, 1, 2, 3].map((beat) => beatFigure(pitches, hand, count, beat))
  const root = rootIndex(key, hand, chordDegree, beats.flat())
  const tonic = handTonicMidi(key, hand)
  return beats.flat().map((degree) => ({
    pitch: pitchAtDegree(key, tonic, root + degree),
    duration: BEAT / count,
    perBeat: count,
  }))
}

/** The whole exercise as data, so the tests can check it without parsing XML. */
export function polyrhythmMeasures(settings: PolyrhythmSettings, key: KeyConfig): PolyrhythmMeasure[] {
  const ratio = POLYRHYTHM_RATIOS[settings.ratio]
  const measures: PolyrhythmMeasure[] = []
  for (let i = 0; i < settings.measureCount - 1; i += 1) {
    const chordDegree = PROGRESSION[i % PROGRESSION.length]
    measures.push({
      chordDegree,
      right: handMeasure(key, 'right', ratio.right, settings.pitches, chordDegree),
      left: handMeasure(key, 'left', ratio.left, settings.pitches, chordDegree),
    })
  }
  // The close: both hands land together on the tonic and hold it.
  measures.push({
    chordDegree: 0,
    right: [{ pitch: pitchAtDegree(key, handTonicMidi(key, 'right'), 0), duration: MEASURE, perBeat: 1 }],
    left: [{ pitch: pitchAtDegree(key, handTonicMidi(key, 'left'), 0), duration: MEASURE, perBeat: 1 }],
  })
  return measures
}

function staffXml(notes: PolyrhythmNote[], staff: 1 | 2): string {
  return notes
    .map((note, index) => {
      const { perBeat } = note
      const at = index % perBeat
      const first = at === 0
      const last = at === perBeat - 1
      const triplet = perBeat === 3
      const timeModification = triplet
        ? `
        <time-modification>
          <actual-notes>3</actual-notes>
          <normal-notes>2</normal-notes>
        </time-modification>`
        : ''
      let beams = ''
      if (perBeat >= 2) {
        const state = first ? 'begin' : last ? 'end' : 'continue'
        beams = `\n        <beam number="1">${state}</beam>`
        if (perBeat === 4) {
          beams += `\n        <beam number="2">${state}</beam>`
        }
      }
      // The beam already groups the three notes, so the "3" alone says it.
      const notations =
        triplet && (first || last)
          ? `
        <notations>
          <tuplet type="${first ? 'start' : 'stop'}"${first ? ' bracket="no" show-number="actual"' : ''}/>
        </notations>`
          : ''
      const alter = note.pitch.alter ?? 0
      return `      <note>
        ${asMusicXmlPitch({ ...note.pitch, alter: alter || undefined })}
        <duration>${note.duration}</duration>
        <voice>${staff}</voice>
        <type>${NOTE_TYPE_BY_COUNT[perBeat]}</type>${timeModification}
        <staff>${staff}</staff>${beams}${notations}
      </note>`
    })
    .join('\n')
}

function attributesXml(fifths: number): string {
  return `      <attributes>
        <divisions>${BEAT}</divisions>
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

export function polyrhythmMusicXml(measures: PolyrhythmMeasure[], key: KeyConfig, title: string): string {
  const body = measures
    .map(
      (measure, index) => `    <measure number="${index + 1}">${index === 0 ? `\n${attributesXml(key.fifths)}` : ''}
${staffXml(measure.right, 1)}
      <backup>
        <duration>${MEASURE}</duration>
      </backup>
${staffXml(measure.left, 2)}
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

export function createPolyrhythmExercise(
  partialSettings: Partial<PolyrhythmSettings>,
  seed: string,
): CreatedPolyrhythmExercise {
  const settings = sanitize(partialSettings)
  const key = resolveKey(settings.key, createSeededRng(seed))
  const measures = polyrhythmMeasures(settings, key)
  const ratio = POLYRHYTHM_RATIOS[settings.ratio]
  const title = `${ratio.right} against ${ratio.left} - ${key.name}`
  return {
    file: createMusicXmlFile(polyrhythmMusicXml(measures, key, title), `polyrhythm-${ratio.right}-${ratio.left}`),
    keyName: key.name,
    tonicPitchClass: key.scale[0].pc,
    accidentalsLabel: accidentalsLabel(key),
    measures,
  }
}
