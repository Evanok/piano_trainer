/**
 * The rhythm-reading drill: one measure of rhythm per question with one note
 * drawn in colour, and the player says where it falls -- which beat, then
 * where inside the beat.
 *
 * Same machinery as the other screen drills: the whole round is one MusicXML,
 * one measure per question, cropped by `ReadingStaff`. Every note sits on the
 * same pitch (B4, the middle line), since pitch would only be noise here, and
 * the target is coloured through MusicXML's own `<notehead color>`, which OSMD
 * reads at load time, so no SVG post-processing is needed.
 *
 * The measures are built from one-beat and two-beat cells, the same scheme as
 * the ostinato melody: a two-beat cell only starts on beat 1 or 3, so no note
 * needs a tie and the beat structure stays visible in the beaming. Beams are
 * explicit per beat, with the sixteenth level written as real runs and hooks
 * (OSMD does not beam on its own).
 */
import type {
  RhythmLevel,
  RhythmQuestion,
  RhythmQuizSettings,
  RhythmSubdivision,
} from '../types/rhythm'
import { RHYTHM_ANSWER_STEPS } from '../types/rhythm'
import type { RhythmAnswerStep } from '../types/rhythm'
import { createMusicXmlFile, createSeededRng, xmlEscape } from './musicKeys'

/** Sixteenths per beat, and so `<divisions>`. */
const BEAT = 4
const MEASURE = 4 * BEAT

/** The coloured note: orange, a hue the answer feedback (rose, emerald) does not use. */
export const RHYTHM_TARGET_COLOR = '#EA580C'

export const DEFAULT_RHYTHM_SETTINGS: RhythmQuizSettings = {
  level: 'eighths',
  questionCount: 20,
  seed: 'rhythm',
}

export const RHYTHM_LEVELS: RhythmLevel[] = ['eighths', 'sixteenths', 'syncopated']

/**
 * Cells in sixteenths, a negative value being a rest. One-beat cells go
 * anywhere, two-beat cells only on beat 1 or 3.
 */
const CELLS: Record<RhythmLevel, { beat: number[][]; twoBeats: number[][] }> = {
  eighths: {
    beat: [[4], [4], [2, 2], [2, 2]],
    twoBeats: [[8], [6, 2]],
  },
  sixteenths: {
    beat: [[4], [2, 2], [1, 1, 2], [2, 1, 1], [1, 1, 1, 1], [3, 1]],
    twoBeats: [[8], [6, 2]],
  },
  syncopated: {
    beat: [[2, 2], [-2, 2], [1, 1, 2], [2, 1, 1], [3, 1], [1, 2, 1], [-1, 1, 2], [-1, 3], [-4], [4]],
    twoBeats: [[2, 4, 2], [-2, 6], [6, 2]],
  },
}

const SUBDIVISIONS: RhythmSubdivision[] = ['beat', 'e', 'and', 'a']

const SUBDIVISION_LABELS: Record<RhythmSubdivision, string> = {
  beat: 'On the beat',
  e: 'e',
  and: '&',
  a: 'a',
}

/** What a note or rest is written as, from its length in sixteenths. */
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

export interface RhythmRound {
  questions: RhythmQuestion[]
  file: File
  steps: RhythmAnswerStep[]
  /** The subdivision buttons: just "on the beat" and "&" while there are no sixteenths. */
  subdivisions: RhythmSubdivision[]
}

export function subdivisionOf(onset: number): RhythmSubdivision {
  return SUBDIVISIONS[onset % BEAT]
}

export function subdivisionLabel(subdivision: RhythmSubdivision): string {
  return SUBDIVISION_LABELS[subdivision]
}

/** How a position is counted aloud: "3" on a beat, "e", "&" or "a" between. */
export function countSyllable(onset: number): string {
  const subdivision = subdivisionOf(onset)
  return subdivision === 'beat' ? String(Math.floor(onset / BEAT) + 1) : SUBDIVISION_LABELS[subdivision]
}

/** "3 &": the beat plus the position inside it, the way the answer is spoken. */
export function positionLabel(question: Pick<RhythmQuestion, 'beat' | 'subdivision'>): string {
  return question.subdivision === 'beat'
    ? `${question.beat}`
    : `${question.beat} ${SUBDIVISION_LABELS[question.subdivision]}`
}

/** Where each entry of `durations` starts, in sixteenths. */
export function onsetsOf(durations: number[]): number[] {
  let position = 0
  return durations.map((value) => {
    const start = position
    position += Math.abs(value)
    return start
  })
}

function sanitize(settings: Partial<RhythmQuizSettings>): RhythmQuizSettings {
  const merged = { ...DEFAULT_RHYTHM_SETTINGS, ...settings }
  return {
    ...merged,
    level: RHYTHM_LEVELS.includes(merged.level) ? merged.level : DEFAULT_RHYTHM_SETTINGS.level,
    questionCount: Math.min(60, Math.max(1, Math.round(merged.questionCount))),
  }
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]
}

function measureDurations(level: RhythmLevel, rng: () => number): number[] {
  const cells = CELLS[level]
  const durations: number[] = []
  let beat = 0
  while (beat < 4) {
    if (beat % 2 === 0 && rng() < 0.35) {
      durations.push(...pick(cells.twoBeats, rng))
      beat += 2
    } else {
      durations.push(...pick(cells.beat, rng))
      beat += 1
    }
  }
  return durations
}

/**
 * The note asked about. Off-beat notes weigh double, since they are the
 * reason the drill exists, and the measure's very first note is never asked:
 * a note right after the barline answers itself.
 */
function pickTarget(durations: number[], previousOnset: number | null, rng: () => number): number | null {
  const onsets = onsetsOf(durations)
  const candidates = durations
    .map((value, index) => ({ index, onset: onsets[index], value }))
    .filter((entry) => entry.value > 0 && entry.onset > 0 && entry.onset !== previousOnset)
  if (candidates.length === 0) {
    return null
  }
  const weights = candidates.map((entry) => (entry.onset % BEAT === 0 ? 1 : 2))
  let roll = rng() * weights.reduce((sum, weight) => sum + weight, 0)
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i]
    if (roll <= 0) {
      return candidates[i].index
    }
  }
  return candidates[candidates.length - 1].index
}

function pickQuestions(settings: RhythmQuizSettings): RhythmQuestion[] {
  const rng = createSeededRng(settings.seed)
  const questions: RhythmQuestion[] = []
  let previousOnset: number | null = null
  while (questions.length < settings.questionCount) {
    const durations = measureDurations(settings.level, rng)
    const targetIndex = pickTarget(durations, previousOnset, rng)
    if (targetIndex === null) {
      continue
    }
    const onset = onsetsOf(durations)[targetIndex]
    previousOnset = onset
    questions.push({
      index: questions.length,
      measureNumber: questions.length + 1,
      durations,
      targetIndex,
      onset,
      beat: Math.floor(onset / BEAT) + 1,
      subdivision: subdivisionOf(onset),
    })
  }
  return questions
}

/**
 * Beam states per note, `null` for a note that is not beamed. A beat's notes
 * shorter than a quarter are beamed together when there are two or more; the
 * second (sixteenth) level joins consecutive sixteenths and gives a lone one a
 * hook towards its neighbour.
 */
function beamsOf(durations: number[]): Array<{ level1: string; level2: string | null } | null> {
  const onsets = onsetsOf(durations)
  const groups = new Map<number, number[]>()
  durations.forEach((value, index) => {
    const beat = Math.floor(onsets[index] / BEAT)
    const fits = value > 0 && value < BEAT && onsets[index] + value <= (beat + 1) * BEAT
    if (fits) {
      groups.set(beat, [...(groups.get(beat) ?? []), index])
    }
  })
  const beams: Array<{ level1: string; level2: string | null } | null> = durations.map(() => null)
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue
    }
    group.forEach((index, at) => {
      const level1 = at === 0 ? 'begin' : at === group.length - 1 ? 'end' : 'continue'
      let level2: string | null = null
      if (durations[index] === 1) {
        const previous = at > 0 && durations[group[at - 1]] === 1
        const next = at < group.length - 1 && durations[group[at + 1]] === 1
        level2 =
          previous && next
            ? 'continue'
            : previous
              ? 'end'
              : next
                ? 'begin'
                : at < group.length - 1
                  ? 'forward hook'
                  : 'backward hook'
      }
      beams[index] = { level1, level2 }
    })
  }
  return beams
}

function measureXml(question: RhythmQuestion): string {
  const beams = beamsOf(question.durations)
  const notes = question.durations
    .map((value, index) => {
      const duration = Math.abs(value)
      const written = NOTE_TYPES[duration]
      const dot = written.dotted ? '\n        <dot/>' : ''
      if (value < 0) {
        return `      <note>
        <rest/>
        <duration>${duration}</duration>
        <voice>1</voice>
        <type>${written.type}</type>${dot}
      </note>`
      }
      const target = index === question.targetIndex
      const color = target ? ` color="${RHYTHM_TARGET_COLOR}"` : ''
      const notehead = target ? `\n        <notehead color="${RHYTHM_TARGET_COLOR}">normal</notehead>` : ''
      const beam = beams[index]
      const beamXml = beam
        ? `\n        <beam number="1">${beam.level1}</beam>${
            beam.level2 ? `\n        <beam number="2">${beam.level2}</beam>` : ''
          }`
        : ''
      return `      <note${color}>
        <pitch>
          <step>B</step>
          <octave>4</octave>
        </pitch>
        <duration>${duration}</duration>
        <voice>1</voice>
        <type>${written.type}</type>${dot}
        <stem>up</stem>${notehead}${beamXml}
      </note>`
    })
    .join('\n')
  const attributes =
    question.measureNumber === 1
      ? `
      <attributes>
        <divisions>${BEAT}</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>`
      : ''
  return `    <measure number="${question.measureNumber}">${attributes}
${notes}
    </measure>`
}

export function generateRhythmQuizMusicXml(questions: RhythmQuestion[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${xmlEscape('Rhythm quiz')}</work-title>
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
${questions.map(measureXml).join('\n')}
  </part>
</score-partwise>
`
}

export function createRhythmRound(settings: Partial<RhythmQuizSettings>): RhythmRound {
  const sanitized = sanitize(settings)
  const questions = pickQuestions(sanitized)
  return {
    questions,
    file: createMusicXmlFile(generateRhythmQuizMusicXml(questions), 'rhythm-quiz'),
    steps: [...RHYTHM_ANSWER_STEPS],
    subdivisions: sanitized.level === 'eighths' ? ['beat', 'and'] : [...SUBDIVISIONS],
  }
}

export { MEASURE as RHYTHM_MEASURE_LENGTH }
