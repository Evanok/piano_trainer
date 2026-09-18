/**
 * The chord-reading drill: draw a triad on a staff, and say which chord it is.
 *
 * Built exactly like the reading quiz, and for the same reason: the whole round
 * is ONE MusicXML score with one chord per measure, loaded once into one OSMD
 * instance, and the quiz screen moves from question to question by cropping to
 * a single measure (`ReadingStaff`). So this generator only has to emit
 * measures, and the engraving is the practice screen's own.
 *
 * The material is the seven diatonic triads of C major, no accidental anywhere,
 * in any of the three positions (`ChordStackMode`). Three facts about it shape
 * everything here.
 *
 * **There is no shape to recognise.** Without accidentals, every root-position
 * triad is the same drawing -- three notes on three consecutive staff
 * positions. Do-mi-sol and re-fa-la are indistinguishable as pictures, so the
 * quality cannot be read off the spacing; it is read off *which* notes they
 * are. What this drill trains is therefore the table of the seven chords of the
 * key (the chord on re is minor), which is the foundation of harmony rather
 * than a pattern-matching trick, but it is worth being clear that they are not
 * the same exercise.
 *
 * **The root and the quality are one answer, not two.** In C major a chord on
 * re *is* minor, so naming the root names the chord -- which is why the `chord`
 * answer mode is a single tap among the seven note names and needs no
 * chord-specific engine code at all (`NamingQuizEngine.answer` already judges
 * `question.step`). Asking for both would be asking the same question twice.
 * That correlation is what written accidentals (the next rung, IDEA.md) break.
 *
 * **Root position alone makes the `chord` mode worthless, which is why the
 * default inverts.** With the chords never inverted, the root is the bottom
 * note, so naming the chord is naming the bottom note and the drill is the
 * reading quiz with two notes drawn on top -- confirmed by playing it, not
 * predicted. Inverting moves the root into the middle or the top of the stack,
 * so it has to be found; `quality` mode survives root position because reading
 * the bottom note and recalling its quality is one recall step more than
 * naming it.
 */
import { createMusicXmlFile, createSeededRng, xmlEscape } from './musicKeys'
import type { Pitch } from './musicKeys'
import { asMusicXmlPitch } from './musicKeys'
import { diatonicIndex, pitchAtDiatonicIndex, STEPS } from './readingQuiz'
import type {
  ChordAccidentalMode,
  ChordAnswerMode,
  ChordClefMode,
  ChordInversion,
  ChordNote,
  ChordQuality,
  ChordQuestion,
  ChordQuizSettings,
  ChordStackMode,
} from '../types/chord'

export type {
  ChordAccidentalMode,
  ChordAnswerMode,
  ChordClefMode,
  ChordInversion,
  ChordNote,
  ChordQuality,
  ChordQuestion,
  ChordQuizSettings,
  ChordStackMode,
}

export interface ChordRound {
  questions: ChordQuestion[]
  file: File
  /**
   * The qualities the answer buttons carry, in a fixed order.
   *
   * Derived from the material rather than from the questions actually drawn: a
   * round that happens to roll no diminished chord must still offer the button,
   * or the buttons would silently tell the player what is coming. And derived
   * rather than hardcoded, so a later level that introduces augmented triads
   * gets its fourth button without touching the screen.
   */
  qualities: ChordQuality[]
  /**
   * The steps the seven name buttons carry in `chord` mode, left to right.
   *
   * Scale order, and no shuffle option unlike the reading quiz. The shortcut a
   * shuffle removes there -- counting buttons instead of reading the note -- is
   * a poor trade here: the answer is a chord's name, which is the thing being
   * learnt as a whole, and finding it among seven familiar positions is part of
   * naming it quickly. On the round rather than in the component so a later
   * rung can reorder them without touching the screen.
   */
  nameOrder: string[]
}

export const DEFAULT_CHORD_QUESTION_COUNT = 20

const DEFAULT_SETTINGS: ChordQuizSettings = {
  // Naming the chord is what reading a piece written on chords asks for, so it
  // is the default; the quality-only mode is the narrower drill.
  answerMode: 'chord',
  accidentalMode: 'none',
  // Inverted by default, because root position alone asks nothing in `chord`
  // mode: the bottom note is the answer. See ChordStackMode.
  stackMode: 'all',
  clefMode: 'treble',
  questionCount: DEFAULT_CHORD_QUESTION_COUNT,
  seed: 'chords',
}

/** The canonical order the quality buttons are drawn in, commonest first. */
const QUALITY_ORDER: ChordQuality[] = ['major', 'minor', 'diminished', 'augmented']

/** How each quality is written on a button and in the stats. */
const QUALITY_LABELS: Record<ChordQuality, string> = {
  major: 'major',
  minor: 'minor',
  diminished: 'diminished',
  augmented: 'augmented',
}

export function chordQualityLabel(quality: ChordQuality): string {
  return QUALITY_LABELS[quality]
}

/** The gap in semitones between the three notes, for each quality. */
const QUALITY_SEMITONES: Record<ChordQuality, [number, number]> = {
  major: [4, 3],
  minor: [3, 4],
  diminished: [3, 3],
  augmented: [4, 4],
}

export function chordQualitySemitones(quality: ChordQuality): [number, number] {
  return QUALITY_SEMITONES[quality]
}

/**
 * The seven triads of C major, by the letter they are built on. Written out
 * rather than derived from the scale because it is also the lesson: three
 * majors (do fa sol), three minors (re mi la) and one diminished (si), and that
 * grouping is what makes the table memorable instead of seven separate facts.
 */
const DIATONIC_TRIADS: Record<string, { quality: ChordQuality; degree: string }> = {
  C: { quality: 'major', degree: 'I' },
  D: { quality: 'minor', degree: 'ii' },
  E: { quality: 'minor', degree: 'iii' },
  F: { quality: 'major', degree: 'IV' },
  G: { quality: 'major', degree: 'V' },
  A: { quality: 'minor', degree: 'vi' },
  B: { quality: 'diminished', degree: 'vii°' },
}

export function diatonicTriadOf(step: string): { quality: ChordQuality; degree: string } {
  return DIATONIC_TRIADS[step.toUpperCase()] ?? DIATONIC_TRIADS.C
}

/**
 * The semitones above the root of a triad's third and fifth, per quality. This
 * is the definition of the four qualities, and the only thing that actually
 * decides one: everything else in this file is bookkeeping around it.
 *
 * Read the first number and you have the rule the drill teaches -- four
 * semitones between the bottom two notes means major, three means minor. The
 * second number only separates diminished from minor and augmented from major.
 */
const QUALITY_INTERVALS: Record<ChordQuality, [number, number]> = {
  major: [4, 7],
  minor: [3, 7],
  diminished: [3, 6],
  augmented: [4, 8],
}

/**
 * Spellings no round ever writes, however valid they are in theory.
 *
 * Altering a letter across one of the two natural half-steps produces a note
 * that is written as its neighbour's own letter (mi sharp sounds like fa, do
 * flat like si). They are real in music, but they make a beginner's chord
 * unreadable for no gain here, and every quality remains reachable without
 * them -- so a chord needing one is simply not drawn.
 */
const AWKWARD_SPELLINGS = new Set(['E1', 'B1', 'F-1', 'C-1'])

function isAwkward(step: string, alter: number): boolean {
  return AWKWARD_SPELLINGS.has(`${step}${alter}`)
}

/**
 * The three chord tones of a triad, as an alteration per tone, given the root's
 * own letter position and alteration.
 *
 * The letters are fixed by the stack (a triad is always a letter, the letter
 * two above, and the letter four above -- that is what makes it three notes on
 * consecutive staff positions), so the quality can only be obtained by altering
 * them. Each alteration is therefore just the gap between what the quality
 * requires and what the natural letters already give.
 *
 * Returns null when any tone would need a double accidental or an awkward
 * spelling, which is how those chords are kept out of the material.
 */
function spellTriad(
  rootIndex: number,
  rootAlter: number,
  quality: ChordQuality,
): [number, number, number] | null {
  const [thirdSemis, fifthSemis] = QUALITY_INTERVALS[quality]
  const rootNatural = pitchAtDiatonicIndex(rootIndex)
  const alters: [number, number, number] = [
    rootAlter,
    thirdSemis - (pitchAtDiatonicIndex(rootIndex + 2).midi - rootNatural.midi) + rootAlter,
    fifthSemis - (pitchAtDiatonicIndex(rootIndex + 4).midi - rootNatural.midi) + rootAlter,
  ]
  for (let tone = 0; tone < 3; tone += 1) {
    const step = pitchAtDiatonicIndex(rootIndex + tone * 2).step
    if (Math.abs(alters[tone]) > 1 || isAwkward(step, alters[tone])) {
      return null
    }
  }
  return alters
}

/**
 * Every note a round may draw, per clef: the staff itself plus one ledger line
 * either side. Past that the drill turns into a register-reading exercise on
 * top of a chord-reading one, and a cropped measure starts clipping.
 *
 * - treble: do4 (one ledger below) to la5 (one ledger above).
 * - bass: mi2 (one ledger below) to do4 (one ledger above).
 */
const NOTE_WINDOW: Record<ChordClefMode, { low: number; high: number }> = {
  treble: { low: diatonicIndex('C', 4), high: diatonicIndex('A', 5) },
  bass: { low: diatonicIndex('E', 2), high: diatonicIndex('C', 4) },
}

/**
 * Where the three notes sit relative to the ROOT's own position, per inversion,
 * in diatonic steps.
 *
 * Root position stacks the root, its third and its fifth: three consecutive
 * staff positions, all lines or all spaces. An inversion moves the bottom
 * note(s) up an octave, which opens a fourth somewhere in the stack -- a
 * visible gap -- and the note just above that gap is the root. That is the one
 * rule the whole inverted drill turns on, and the lesson states it as such.
 *
 * Note that for inversions 1 and 2 the root's own position is not in the stack
 * at all; the root appears an octave up, at +7.
 */
const STACK_OFFSETS: Record<ChordInversion, [number, number, number]> = {
  0: [0, 2, 4],
  1: [2, 4, 7],
  2: [4, 7, 9],
}

/**
 * Which chord tone each drawn note is, per inversion, as an index into the
 * root/third/fifth triple. Parallel to STACK_OFFSETS: an inversion reorders the
 * same three tones, it does not change them, so the alteration computed for a
 * tone travels with it wherever the stack puts it.
 */
const STACK_TONES: Record<ChordInversion, [number, number, number]> = {
  0: [0, 1, 2],
  1: [1, 2, 0],
  2: [2, 0, 1],
}

export const CHORD_INVERSIONS: ChordInversion[] = [0, 1, 2]

/** "root position", "1st inversion", "2nd inversion". */
export function chordInversionLabel(inversion: ChordInversion): string {
  return inversion === 0 ? 'root position' : inversion === 1 ? '1st inversion' : '2nd inversion'
}

/**
 * The lowest root each (clef, inversion) draws from. The seven roots are then
 * that one and the six above it, so an inversion's chords form one ascending
 * run through the letters rather than each chord being placed on its own.
 *
 * It has to be computed per inversion rather than fixed once, because an
 * inverted stack is taller than a root-position one and sits higher above its
 * root: the octave that keeps do4-mi4-sol4 on the staff does not keep
 * mi4-sol4-do5 on it. Among the bases whose whole run fits the clef's window,
 * the one centring the run in it is taken -- centring each *chord*
 * independently was tried first and was worse, since it put the do chord an
 * octave above the other six, which looks arbitrary because it is.
 */
function baseRootFor(clefMode: ChordClefMode, inversion: ChordInversion): number | null {
  const { low, high } = NOTE_WINDOW[clefMode]
  const offsets = STACK_OFFSETS[inversion]
  const bottom = offsets[0]
  const top = offsets[2]
  const center = (low + high) / 2
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  // The run is base..base+6, so its lowest note is base+bottom and its highest
  // is the top note of the last root in it.
  for (let base = 0; base <= 8 * STEPS.length; base += 1) {
    if (base + bottom < low || base + 6 + top > high) {
      continue
    }
    const distance = Math.abs((base + bottom + base + 6 + top) / 2 - center)
    if (distance < bestDistance) {
      best = base
      bestDistance = distance
    }
  }
  return best
}

/** One drawable chord: where it sits, how it is stacked, and how it is spelled. */
export interface ChordPlacement {
  stepIndex: number
  rootAlter: number
  quality: ChordQuality
  inversion: ChordInversion
  /** Diatonic index of the root's LETTER, which is its staff position. */
  root: number
  /** Alteration per chord tone: root, third, fifth. */
  alters: [number, number, number]
  /** True when the chord is one of do major's own seven (no accidental at all). */
  diatonic: boolean
}

/**
 * Every chord a round can draw, per clef, precomputed at module load so
 * `pickQuestions` only has to pick one.
 *
 * An alteration never moves a note: it is a symbol on a notehead, and the
 * staff position stays the letter's. So the per-inversion run of seven root
 * letters above is unaffected by accidentals, and the window check with it --
 * the table just gains the alteration and quality dimensions on top of it.
 */
const PLACEMENTS: Record<ChordClefMode, ChordPlacement[]> = { treble: [], bass: [] }

for (const clefMode of ['treble', 'bass'] as const) {
  for (const inversion of CHORD_INVERSIONS) {
    const base = baseRootFor(clefMode, inversion)
    if (base === null) {
      continue
    }
    for (let offset = 0; offset < STEPS.length; offset += 1) {
      const root = base + offset
      for (const rootAlter of [0, -1, 1]) {
        for (const quality of QUALITY_ORDER) {
          const alters = spellTriad(root, rootAlter, quality)
          if (alters === null) {
            continue
          }
          PLACEMENTS[clefMode].push({
            stepIndex: root % STEPS.length,
            rootAlter,
            quality,
            inversion,
            root,
            alters,
            diatonic: alters.every((alter) => alter === 0),
          })
        }
      }
    }
  }
}

/**
 * The chords a round with these settings draws from.
 *
 * `accidentalMode: 'none'` keeps only the chords with no accidental anywhere,
 * which is exactly do major's seven. And naming the chord is restricted to
 * natural roots whatever the mode, because the seven name buttons cannot say
 * "fa sharp" -- the quality answer has no such limit, so that is the mode where
 * the whole material is in play.
 */
export function chordPlacements(
  clefMode: ChordClefMode,
  settings: Pick<ChordQuizSettings, 'stackMode' | 'accidentalMode' | 'answerMode'>,
): ChordPlacement[] {
  return PLACEMENTS[clefMode].filter((entry) => {
    if (settings.stackMode === 'root' && entry.inversion !== 0) {
      return false
    }
    if (settings.accidentalMode === 'none' && !entry.diatonic) {
      return false
    }
    return !(settings.answerMode === 'chord' && entry.rootAlter !== 0)
  })
}

/** The seven root-position roots, lowest first. Used by the lesson's table. */
export function chordRoots(clefMode: ChordClefMode): number[] {
  return [
    ...new Set(
      chordPlacements(clefMode, {
        stackMode: 'root',
        accidentalMode: 'none',
        answerMode: 'chord',
      }).map((entry) => entry.root),
    ),
  ].sort((a, b) => a - b)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function sanitize(settings: Partial<ChordQuizSettings>): ChordQuizSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return { ...merged, questionCount: clamp(Math.round(merged.questionCount), 1, 60) }
}

function noteAt(index: number, alter: number): ChordNote {
  const pitch = pitchAtDiatonicIndex(index)
  return { midi: pitch.midi + alter, step: pitch.step, alter, octave: pitch.octave }
}

/**
 * The drawn notes of a placement, bottom to top -- which is the order they are
 * read in and the order MusicXML wants them.
 *
 * `STACK_OFFSETS` says where the three notes sit and `STACK_TONES` says which
 * chord tone each one is, so an inversion carries each tone's alteration with
 * it instead of re-deriving anything.
 */
export function triadNotes(placement: ChordPlacement): ChordNote[] {
  const offsets = STACK_OFFSETS[placement.inversion]
  const tones = STACK_TONES[placement.inversion]
  return offsets.map((offset, i) => noteAt(placement.root + offset, placement.alters[tones[i]]))
}

/** The plain diatonic triad on a root index, for the lesson's own table. */
export function triadAt(rootIndex: number, inversion: ChordInversion = 0): ChordNote[] {
  const root = pitchAtDiatonicIndex(rootIndex)
  const quality = diatonicTriadOf(root.step).quality
  return triadNotes({
    stepIndex: rootIndex % STEPS.length,
    rootAlter: 0,
    quality,
    inversion,
    root: rootIndex,
    alters: [0, 0, 0],
    diatonic: true,
  })
}

function pickQuestions(settings: ChordQuizSettings): ChordQuestion[] {
  const rng = createSeededRng(settings.seed)
  const placements = chordPlacements(settings.clefMode, settings)
  const questions: ChordQuestion[] = []
  let previousStepIndex = -1
  for (let i = 0; i < settings.questionCount; i += 1) {
    // Never the same CHORD twice running (whatever its inversion): the answer
    // would be free, and a repeat reads as the screen having failed to advance.
    // Two inversions of the same chord back to back would also turn the second
    // into a free one, which is precisely the shortcut this drill is about.
    let placement = placements[Math.floor(rng() * placements.length)]
    for (let attempt = 0; attempt < 8 && placement.stepIndex === previousStepIndex; attempt += 1) {
      placement = placements[Math.floor(rng() * placements.length)]
    }
    previousStepIndex = placement.stepIndex
    const step = STEPS[placement.stepIndex]
    questions.push({
      index: i,
      measureNumber: i + 1,
      step,
      rootAlter: placement.rootAlter,
      notes: triadNotes(placement),
      quality: placement.quality,
      // A degree names a chord's place in a key, so only do major's own seven
      // have one here; sol minor would need a key this round is not in.
      degree: placement.diatonic ? diatonicTriadOf(step).degree : null,
      inversion: placement.inversion,
    })
  }
  return questions
}

/** Every quality that can come up in this key, in the buttons' own order. */
export function chordQualitiesInPlay(): ChordQuality[] {
  const present = new Set(Object.values(DIATONIC_TRIADS).map((triad) => triad.quality))
  return QUALITY_ORDER.filter((quality) => present.has(quality))
}

const ACCIDENTAL_NAMES: Record<number, string> = { [-1]: 'flat', 0: 'natural', 1: 'sharp' }

function noteXml(note: ChordNote, isChordTone: boolean): string {
  const pitch: Pitch = {
    midi: note.midi,
    step: note.step,
    alter: note.alter || undefined,
    octave: note.octave,
    degree: 0,
  }
  // The second and third notes of a chord carry <chord/>, which is what makes
  // OSMD stack them on one stem instead of drawing three separate whole notes.
  const chord = isChordTone ? '\n        <chord/>' : ''
  // <alter> sets the pitch; <accidental> is the printed symbol, and it is
  // emitted explicitly rather than left to the renderer to infer -- the round
  // has no key signature, so every altered note must show its own sign.
  const accidental = note.alter
    ? `\n        <accidental>${ACCIDENTAL_NAMES[note.alter]}</accidental>`
    : ''
  return `      <note>${chord}
        ${asMusicXmlPitch(pitch)}
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>${accidental}
      </note>`
}

function attributesXml(clefMode: ChordClefMode): string {
  const isBass = clefMode === 'bass'
  return `      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>${isBass ? 'F' : 'G'}</sign>
          <line>${isBass ? 4 : 2}</line>
        </clef>
      </attributes>`
}

function measureXml(question: ChordQuestion, clefMode: ChordClefMode): string {
  const attributes = question.measureNumber === 1 ? `\n${attributesXml(clefMode)}\n` : '\n'
  const notes = question.notes.map((note, index) => noteXml(note, index > 0)).join('\n')
  return `    <measure number="${question.measureNumber}">${attributes}${notes}
    </measure>`
}

export function generateChordQuizMusicXml(
  questions: ChordQuestion[],
  clefMode: ChordClefMode,
): string {
  const measures = questions.map((question) => measureXml(question, clefMode)).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${xmlEscape('Chord quiz')}</work-title>
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

export function createChordRound(settings: Partial<ChordQuizSettings>): ChordRound {
  const sanitized = sanitize(settings)
  const questions = pickQuestions(sanitized)
  return {
    questions,
    file: createMusicXmlFile(
      generateChordQuizMusicXml(questions, sanitized.clefMode),
      'chord-quiz',
    ),
    qualities: chordQualitiesInPlay(),
    nameOrder: [...STEPS],
  }
}
