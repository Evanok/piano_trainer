/**
 * The keyboard-free reading quiz: pick random notes on a staff, and render the
 * whole round as ONE MusicXML score with one note per measure.
 *
 * One measure per question is the whole trick. The quiz screen loads that score
 * into a single OSMD instance and moves from question to question by cropping to
 * one measure (the same MinMeasureToDrawIndex/MaxMeasureToDrawIndex crop the
 * section modes use), so a rapid-fire quiz costs one load per round instead of
 * one OSMD instance per question, and the engraving is identical to the practice
 * screen's without a second notation renderer to maintain.
 */
import { asMusicXmlPitch, createMusicXmlFile, createSeededRng, xmlEscape } from './musicKeys'
import type { Pitch } from './musicKeys'
import type {
  ReadingAnswerMode,
  ReadingClefMode,
  ReadingLedgerLevel,
  ReadingNameOrder,
  ReadingQuestion,
  ReadingQuizSettings,
} from '../types/reading'

export type {
  ReadingAnswerMode,
  ReadingClefMode,
  ReadingLedgerLevel,
  ReadingNameOrder,
  ReadingQuestion,
  ReadingQuizSettings,
}

export interface ReadingRound {
  questions: ReadingQuestion[]
  file: File
  /**
   * The steps the seven name buttons carry, left to right. Part of the round
   * rather than of the screen so it is drawn from the round's own seed, stays
   * put for every question of that round, and rerolls when the round does.
   */
  nameOrder: string[]
}

export const DEFAULT_READING_QUESTION_COUNT = 20

const DEFAULT_SETTINGS: ReadingQuizSettings = {
  answerMode: 'name',
  nameOrder: 'scale',
  clefMode: 'treble',
  ledgerLevel: 1,
  questionCount: DEFAULT_READING_QUESTION_COUNT,
  seed: 'reading',
}

/**
 * The seven natural notes in scale order, which is the vocabulary every naming
 * quiz answers in. Exported because the note-order drill walks the same ring.
 */
export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/**
 * Latin note names, which is what the quiz answers with. The rest of the app
 * speaks letter names (VirtualKeyboard, noteNames.ts); this is the reading UI's
 * vocabulary only, per the user's explicit choice.
 */
export const LATIN_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si']

export function latinNameOf(step: string): string {
  const index = STEPS.indexOf(step.toUpperCase())
  return index < 0 ? step : LATIN_NAMES[index]
}

/**
 * Whether counting N buttons along still means counting N notes along.
 *
 * That is the shortcut a shuffled order exists to remove, and it survives more
 * than the plain do-re-mi order: every rotation of it keeps every gap, the
 * reversal does too, and so does any ladder built on a constant step (do fa si
 * mi la re sol steps by a fourth each time). All of them share one property --
 * the gap between neighbouring buttons, counted around the seven notes, is the
 * same everywhere -- so that is what is tested and rejected, rather than
 * listing the arrangements.
 */
export function isCountableOrder(order: readonly string[]): boolean {
  if (order.length < 3) {
    return true
  }
  const gapAt = (i: number) => (STEPS.indexOf(order[i + 1]) - STEPS.indexOf(order[i]) + 7) % 7
  const first = gapAt(0)
  for (let i = 1; i < order.length - 1; i += 1) {
    if (gapAt(i) !== first) {
      return false
    }
  }
  return true
}

// Under 1% of the 5040 arrangements are countable, so a couple of rerolls is
// always enough in practice; the cap only exists so this cannot spin.
const SHUFFLE_ATTEMPTS = 16

/**
 * The seven steps in an order no interval arithmetic can walk. Seeded from the
 * round, so the same round always shows the same buttons and a replay does not.
 */
export function shuffleNameOrder(seed: string): string[] {
  const rng = createSeededRng(`${seed}:names`)
  let order = [...STEPS]
  for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS; attempt += 1) {
    order = [...STEPS]
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    if (!isCountableOrder(order)) {
      return order
    }
  }
  // Never reached with the current rng, and still not the scale order.
  return ['G', 'C', 'A', 'E', 'B', 'D', 'F']
}

/** "do4", the latin name plus the octave, for stats that do judge the octave. */
export function pitchLabel(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  const step = STEPS[[0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][midi % 12]]
  return `${latinNameOf(step)}${octave}`
}

/**
 * Diatonic position: counts only the seven natural notes, so C4 and D4 are
 * adjacent (unlike MIDI numbers, where a black key sits between them). Staff
 * geometry is diatonic -- one step on the staff is one of these -- so every
 * range bound here is expressed in this space rather than in semitones.
 */
function diatonicIndex(step: string, octave: number): number {
  return octave * 7 + STEPS.indexOf(step)
}

const SEMITONE_OF_STEP = [0, 2, 4, 5, 7, 9, 11]

function pitchAtDiatonicIndex(index: number): Pitch {
  const octave = Math.floor(index / 7)
  const stepIndex = index - octave * 7
  return {
    midi: (octave + 1) * 12 + SEMITONE_OF_STEP[stepIndex],
    step: STEPS[stepIndex],
    octave,
    degree: stepIndex,
  }
}

/** Bottom and top LINE of each staff, so the ledger level extends from there. */
const STAFF_BOUNDS = {
  // E4 to F5.
  treble: { low: diatonicIndex('E', 4), high: diatonicIndex('F', 5) },
  // G2 to A3.
  bass: { low: diatonicIndex('G', 2), high: diatonicIndex('A', 3) },
} as const

function boundsFor(clef: 'treble' | 'bass', ledgerLevel: number): { low: number; high: number } {
  const base = STAFF_BOUNDS[clef]
  return { low: base.low - 2 * ledgerLevel, high: base.high + 2 * ledgerLevel }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function sanitize(settings: Partial<ReadingQuizSettings>): ReadingQuizSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return {
    ...merged,
    ledgerLevel: clamp(Math.round(merged.ledgerLevel), 0, 3) as ReadingLedgerLevel,
    questionCount: clamp(Math.round(merged.questionCount), 1, 60),
  }
}

function pickQuestions(settings: ReadingQuizSettings): ReadingQuestion[] {
  const rng = createSeededRng(settings.seed)
  const questions: ReadingQuestion[] = []
  let previousIndex = -1
  for (let i = 0; i < settings.questionCount; i += 1) {
    const clef: 'treble' | 'bass' =
      settings.clefMode === 'both' ? (rng() < 0.5 ? 'treble' : 'bass') : settings.clefMode
    const { low, high } = boundsFor(clef, settings.ledgerLevel)
    // Never ask the same note twice in a row: the answer would be visible
    // without reading it, and a repeat looks like the screen failed to advance.
    let index = previousIndex
    for (let attempt = 0; attempt < 8 && index === previousIndex; attempt += 1) {
      index = low + Math.floor(rng() * (high - low + 1))
    }
    previousIndex = index
    const pitch = pitchAtDiatonicIndex(index)
    questions.push({
      index: i,
      measureNumber: i + 1,
      midi: pitch.midi,
      step: pitch.step,
      octave: pitch.octave,
      clef,
    })
  }
  return questions
}

function restXml(staff: 1 | 2, voice: 1 | 2): string {
  return `      <note>
        <rest/>
        <duration>4</duration>
        <voice>${voice}</voice>
        <type>whole</type>
        <staff>${staff}</staff>
      </note>`
}

function noteXml(question: ReadingQuestion, staff: 1 | 2, voice: 1 | 2, withStaff: boolean): string {
  const pitch: Pitch = {
    midi: question.midi,
    step: question.step,
    octave: question.octave,
    degree: 0,
  }
  const staffXml = withStaff ? `\n        <staff>${staff}</staff>` : ''
  return `      <note>
        ${asMusicXmlPitch(pitch)}
        <duration>4</duration>
        <voice>${voice}</voice>
        <type>whole</type>${staffXml}
      </note>`
}

function attributesXml(clefMode: ReadingClefMode): string {
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

function measureXml(question: ReadingQuestion, clefMode: ReadingClefMode): string {
  const attributes =
    question.measureNumber === 1 ? `\n${attributesXml(clefMode)}\n` : '\n'
  if (clefMode !== 'both') {
    return `    <measure number="${question.measureNumber}">${attributes}${noteXml(question, 1, 1, false)}
    </measure>`
  }
  // Grand staff: the note goes on the staff its clef belongs to and the other
  // staff carries a whole rest, so a mixed-clef round reads like a real score
  // rather than switching clef every measure on one staff.
  const onTreble = question.clef === 'treble'
  return `    <measure number="${question.measureNumber}">${attributes}${
    onTreble ? noteXml(question, 1, 1, true) : restXml(1, 1)
  }
      <backup>
        <duration>4</duration>
      </backup>
${onTreble ? restXml(2, 2) : noteXml(question, 2, 2, true)}
    </measure>`
}

export function generateReadingQuizMusicXml(
  questions: ReadingQuestion[],
  clefMode: ReadingClefMode,
): string {
  const measures = questions.map((question) => measureXml(question, clefMode)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${xmlEscape('Reading quiz')}</work-title>
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

/**
 * The lowest and highest note a round with these settings can ask for. Shown in
 * the setup screen, because "ledger level" is jargon that says nothing about
 * what will actually appear on screen -- the notes themselves do.
 */
export function readingRange(settings: Pick<ReadingQuizSettings, 'clefMode' | 'ledgerLevel'>): {
  lowMidi: number
  highMidi: number
  noteCount: number
} {
  const clefs: Array<'treble' | 'bass'> =
    settings.clefMode === 'both' ? ['treble', 'bass'] : [settings.clefMode]
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  let noteCount = 0
  for (const clef of clefs) {
    const bounds = boundsFor(clef, settings.ledgerLevel)
    low = Math.min(low, pitchAtDiatonicIndex(bounds.low).midi)
    high = Math.max(high, pitchAtDiatonicIndex(bounds.high).midi)
    noteCount += bounds.high - bounds.low + 1
  }
  return { lowMidi: low, highMidi: high, noteCount }
}

export function createReadingRound(settings: Partial<ReadingQuizSettings>): ReadingRound {
  const sanitized = sanitize(settings)
  const questions = pickQuestions(sanitized)
  return {
    questions,
    file: createMusicXmlFile(
      generateReadingQuizMusicXml(questions, sanitized.clefMode),
      'reading-quiz',
    ),
    nameOrder: sanitized.nameOrder === 'shuffled' ? shuffleNameOrder(sanitized.seed) : [...STEPS],
  }
}
