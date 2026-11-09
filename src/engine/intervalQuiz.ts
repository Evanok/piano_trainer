/**
 * The interval-reading drill: two notes on a staff, named by their distance.
 *
 * Built exactly like the reading quiz and the chord drill: the whole round is
 * ONE MusicXML score with one question per measure, and the screen moves from
 * question to question by cropping `ReadingStaff` to the current measure.
 *
 * An interval has two names and they are found in two different ways, which is
 * why a question asks them as two steps (`IntervalAnswerStep`):
 *
 * - **The number** is pure staff geometry: count the letters from one note to
 *   the other, both included (do-mi is do re mi, a third). Line to line or space
 *   to space is always odd, line to space always even.
 * - **The quality** is a count of semitones, compared with what that number
 *   holds in a major scale built on the lower note. Only the number says which
 *   comparison to make, so the quality comes second.
 *
 * Every quality is computed from the two spelled notes (`intervalQuality`),
 * never stored by hand, and the generator only keeps intervals whose quality is
 * one a piece actually writes (`ALLOWED_QUALITIES`): an augmented third exists
 * on paper and nowhere else.
 */
import {
  asMusicXmlPitch,
  createMusicXmlFile,
  createSeededRng,
  xmlEscape,
} from './musicKeys'
import type { Pitch } from './musicKeys'
import { boundsFor, diatonicIndex, latinNameOf, pitchAtDiatonicIndex } from './readingQuiz'
import { INTERVAL_ANSWER_STEPS } from '../types/interval'
import type {
  IntervalAnswerStep,
  IntervalClefMode,
  IntervalNote,
  IntervalQuality,
  IntervalQuestion,
  IntervalQuizSettings,
} from '../types/interval'

export interface IntervalRound {
  questions: IntervalQuestion[]
  file: File
  steps: IntervalAnswerStep[]
  /** The number buttons, 2 up to the round's widest interval. */
  numbers: number[]
  /** The quality buttons, always all five: a subset would say what is coming. */
  qualities: IntervalQuality[]
}

export const DEFAULT_INTERVAL_SETTINGS: IntervalQuizSettings = {
  answerSteps: ['number', 'quality'],
  layout: 'harmonic',
  accidentalMode: 'none',
  clefMode: 'treble',
  maxNumber: 8,
  questionCount: 20,
  seed: 'intervals',
}

/** Dim to aug, narrowest first, so the buttons read as a scale of widths. */
export const INTERVAL_QUALITIES: IntervalQuality[] = [
  'diminished',
  'minor',
  'perfect',
  'major',
  'augmented',
]

/** Semitones of the major (2, 3, 6, 7) or perfect (4, 5, 8) interval of each number. */
const REFERENCE_SEMITONES: Record<number, number> = { 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 8: 12 }

const PERFECT_NUMBERS = new Set([4, 5, 8])

/**
 * The qualities a piece really writes, per number. Everything else a single
 * accidental can produce (augmented third, diminished sixth, augmented octave)
 * is theory-book material and would only teach a name never met. The natural
 * notes alone already produce every entry except the augmented second and
 * sixth and the diminished seventh, which are the three that come with
 * accidentals in real minor keys.
 */
export const ALLOWED_QUALITIES: Record<number, IntervalQuality[]> = {
  2: ['minor', 'major', 'augmented'],
  3: ['minor', 'major'],
  4: ['perfect', 'augmented'],
  5: ['diminished', 'perfect', 'augmented'],
  6: ['minor', 'major', 'augmented'],
  7: ['diminished', 'minor', 'major'],
  8: ['perfect'],
}

/**
 * The spellings that cross a natural half step (mi♯, si♯, fa♭, do♭): legal,
 * but they name a white key by another letter, which is a lesson about
 * enharmonics rather than about intervals. Same refusal as the chord drill.
 */
const AWKWARD_SPELLINGS = new Set(['E1', 'B1', 'F-1', 'C-1'])

/** Accidentals per round when they are on: about half the questions. */
const ACCIDENTAL_SHARE = 0.5
const ACCIDENTAL_ATTEMPTS = 12

/**
 * The quality of `number` spanning `semitones`, or null when it is not one of
 * the five (a doubly augmented interval, say). Pure arithmetic on the two
 * spelled notes: the gap to the major/perfect reference decides it.
 */
export function intervalQuality(number: number, semitones: number): IntervalQuality | null {
  const reference = REFERENCE_SEMITONES[number]
  if (reference === undefined) {
    return null
  }
  const delta = semitones - reference
  if (PERFECT_NUMBERS.has(number)) {
    return delta === 0 ? 'perfect' : delta === -1 ? 'diminished' : delta === 1 ? 'augmented' : null
  }
  return delta === 0
    ? 'major'
    : delta === -1
      ? 'minor'
      : delta === -2
        ? 'diminished'
        : delta === 1
          ? 'augmented'
          : null
}

const NUMBER_LABELS: Record<number, string> = {
  2: '2nd',
  3: '3rd',
  4: '4th',
  5: '5th',
  6: '6th',
  7: '7th',
  8: 'octave',
}

export function intervalNumberLabel(number: number): string {
  return NUMBER_LABELS[number] ?? `${number}th`
}

export function intervalQualityLabel(quality: IntervalQuality): string {
  return quality
}

/** "major 3rd", "perfect octave". */
export function intervalName(question: Pick<IntervalQuestion, 'number' | 'quality'>): string {
  return `${intervalQualityLabel(question.quality)} ${intervalNumberLabel(question.number)}`
}

const ALTER_SIGNS: Record<number, string> = { [-1]: '♭', 0: '', 1: '♯' }

/** "sol♯4": the latin name, its sign, its octave. */
export function intervalNoteLabel(note: IntervalNote): string {
  return `${latinNameOf(note.step)}${ALTER_SIGNS[note.alter] ?? ''}${note.octave}`
}

/**
 * "do re mi": the letters counted to find the number, from the lower note up.
 * Spelled without accidentals on purpose: an accidental never changes the
 * number, and naming the signs would hand the quality step its answer.
 */
export function intervalCountedLetters(question: IntervalQuestion): string {
  const start = diatonicIndex(question.lower.step, question.lower.octave)
  const letters: string[] = []
  for (let offset = 0; offset < question.number; offset += 1) {
    letters.push(latinNameOf(pitchAtDiatonicIndex(start + offset).step))
  }
  return letters.join(' ')
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function sanitizeSteps(steps: IntervalAnswerStep[] | undefined): IntervalAnswerStep[] {
  const wanted = new Set(Array.isArray(steps) ? steps : [])
  const ordered = INTERVAL_ANSWER_STEPS.filter((step) => wanted.has(step))
  return ordered.length > 0 ? ordered : ['number']
}

function sanitize(settings: Partial<IntervalQuizSettings>): IntervalQuizSettings {
  const merged = { ...DEFAULT_INTERVAL_SETTINGS, ...settings }
  return {
    ...merged,
    answerSteps: sanitizeSteps(merged.answerSteps),
    maxNumber: merged.maxNumber === 5 ? 5 : 8,
    questionCount: clamp(Math.round(merged.questionCount), 1, 60),
  }
}

function naturalNote(diatonic: number): IntervalNote {
  const pitch = pitchAtDiatonicIndex(diatonic)
  return { midi: pitch.midi, step: pitch.step, alter: 0, octave: pitch.octave }
}

function altered(note: IntervalNote, alter: number): IntervalNote {
  return { ...note, alter, midi: note.midi - note.alter + alter }
}

/**
 * Lets one of the two notes carry a sharp or a flat, and keeps the result only
 * if it is still an interval worth naming. Null when no attempt found one, in
 * which case the natural pair stands.
 */
function withAccidental(
  lower: IntervalNote,
  upper: IntervalNote,
  number: number,
  rng: () => number,
): { lower: IntervalNote; upper: IntervalNote } | null {
  for (let attempt = 0; attempt < ACCIDENTAL_ATTEMPTS; attempt += 1) {
    const alter = rng() < 0.5 ? -1 : 1
    const onUpper = rng() < 0.5
    const target = onUpper ? upper : lower
    if (AWKWARD_SPELLINGS.has(`${target.step}${alter}`)) {
      continue
    }
    const nextLower = onUpper ? lower : altered(lower, alter)
    const nextUpper = onUpper ? altered(upper, alter) : upper
    const quality = intervalQuality(number, nextUpper.midi - nextLower.midi)
    if (quality !== null && ALLOWED_QUALITIES[number].includes(quality)) {
      return { lower: nextLower, upper: nextUpper }
    }
  }
  return null
}

function pickQuestions(settings: IntervalQuizSettings): IntervalQuestion[] {
  const rng = createSeededRng(settings.seed)
  const questions: IntervalQuestion[] = []
  let previous: { number: number; low: number } | null = null
  for (let i = 0; i < settings.questionCount; i += 1) {
    const clef: 'treble' | 'bass' =
      settings.clefMode === 'both' ? (rng() < 0.5 ? 'treble' : 'bass') : settings.clefMode
    // The staff plus one ledger line either side: both notes stay readable and
    // the cropped measure never clips. The window spans fifteen notes, so even
    // an octave has eight possible bottoms.
    const window = boundsFor(clef, 1)
    let number = 2
    let low = window.low
    // Never the same interval on the same bottom note twice running: it would
    // look like the screen failed to advance.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      number = 2 + Math.floor(rng() * (settings.maxNumber - 1))
      low = window.low + Math.floor(rng() * (window.high - window.low - number + 2))
      if (!previous || previous.number !== number || previous.low !== low) {
        break
      }
    }
    previous = { number, low }

    let lower = naturalNote(low)
    let upper = naturalNote(low + number - 1)
    if (settings.accidentalMode === 'all' && rng() < ACCIDENTAL_SHARE) {
      const spelled = withAccidental(lower, upper, number, rng)
      if (spelled) {
        lower = spelled.lower
        upper = spelled.upper
      }
    }
    const semitones = upper.midi - lower.midi
    const melodic =
      settings.layout === 'melodic' || (settings.layout === 'mixed' && rng() < 0.5)
    questions.push({
      index: i,
      measureNumber: i + 1,
      clef,
      lower,
      upper,
      number,
      // Never null: naturals always land on an allowed quality, and an
      // accidental is only kept when it does.
      quality: intervalQuality(number, semitones) ?? 'perfect',
      semitones,
      melodic,
      descending: melodic && rng() < 0.5,
    })
  }
  return questions
}

const ACCIDENTAL_NAMES: Record<number, string> = { [-1]: 'flat', 1: 'sharp' }

function noteXml(
  note: IntervalNote,
  options: { chord: boolean; duration: number; type: string; staff: 1 | 2 | null },
): string {
  const pitch: Pitch = {
    midi: note.midi,
    step: note.step,
    alter: note.alter || undefined,
    octave: note.octave,
    degree: 0,
  }
  // No key signature, so a sign is printed exactly when the note is altered.
  const accidental = note.alter !== 0 ? `\n        <accidental>${ACCIDENTAL_NAMES[note.alter]}</accidental>` : ''
  const staff = options.staff === null ? '' : `\n        <staff>${options.staff}</staff>`
  return `      <note>${options.chord ? '\n        <chord/>' : ''}
        ${asMusicXmlPitch(pitch)}
        <duration>${options.duration}</duration>
        <voice>${options.staff ?? 1}</voice>
        <type>${options.type}</type>${accidental}${staff}
      </note>`
}

function restXml(staff: 1 | 2): string {
  return `      <note>
        <rest/>
        <duration>4</duration>
        <voice>${staff}</voice>
        <type>whole</type>
        <staff>${staff}</staff>
      </note>`
}

/** The two notes of a question, stacked (one whole-note chord) or in a row (two halves). */
function intervalNotesXml(question: IntervalQuestion, staff: 1 | 2 | null): string {
  if (!question.melodic) {
    return [
      noteXml(question.lower, { chord: false, duration: 4, type: 'whole', staff }),
      noteXml(question.upper, { chord: true, duration: 4, type: 'whole', staff }),
    ].join('\n')
  }
  const [first, second] = question.descending
    ? [question.upper, question.lower]
    : [question.lower, question.upper]
  return [
    noteXml(first, { chord: false, duration: 2, type: 'half', staff }),
    noteXml(second, { chord: false, duration: 2, type: 'half', staff }),
  ].join('\n')
}

function attributesXml(clefMode: IntervalClefMode): string {
  const time = `        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>`
  if (clefMode === 'both') {
    return `      <attributes>
${time}
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
  const isBass = clefMode === 'bass'
  return `      <attributes>
${time}
        <clef>
          <sign>${isBass ? 'F' : 'G'}</sign>
          <line>${isBass ? 4 : 2}</line>
        </clef>
      </attributes>`
}

function measureXml(question: IntervalQuestion, clefMode: IntervalClefMode): string {
  const attributes = question.measureNumber === 1 ? `\n${attributesXml(clefMode)}\n` : '\n'
  if (clefMode !== 'both') {
    return `    <measure number="${question.measureNumber}">${attributes}${intervalNotesXml(question, null)}
    </measure>`
  }
  // Grand staff: the interval on its own clef's staff, a whole rest on the other.
  const onTreble = question.clef === 'treble'
  return `    <measure number="${question.measureNumber}">${attributes}${
    onTreble ? intervalNotesXml(question, 1) : restXml(1)
  }
      <backup>
        <duration>4</duration>
      </backup>
${onTreble ? restXml(2) : intervalNotesXml(question, 2)}
    </measure>`
}

export function generateIntervalQuizMusicXml(
  questions: IntervalQuestion[],
  clefMode: IntervalClefMode,
): string {
  const measures = questions.map((question) => measureXml(question, clefMode)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${xmlEscape('Interval quiz')}</work-title>
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
${measures}
  </part>
</score-partwise>
`
}

export function createIntervalRound(settings: Partial<IntervalQuizSettings>): IntervalRound {
  const sanitized = sanitize(settings)
  const questions = pickQuestions(sanitized)
  const numbers: number[] = []
  for (let number = 2; number <= sanitized.maxNumber; number += 1) {
    numbers.push(number)
  }
  return {
    questions,
    file: createMusicXmlFile(generateIntervalQuizMusicXml(questions, sanitized.clefMode), 'interval-quiz'),
    steps: sanitized.answerSteps,
    numbers,
    qualities: [...INTERVAL_QUALITIES],
  }
}
