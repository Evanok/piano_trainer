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
 * **The root and the quality are one answer only while there is no
 * accidental.** In C major a chord on re *is* minor, so naming the root names
 * the chord, and the `root` step needs no chord-specific engine code at all
 * (`NamingQuizEngine.answer` already judges `question.step`). Written
 * accidentals break that correlation -- sol major and sol minor both come up --
 * and then the two have to be asked one after the other, which is what
 * `ChordAnswerStep` is for.
 *
 * **Root position alone makes the `root` step worthless, which is why the
 * default inverts.** With the chords never inverted, the root is the bottom
 * note, so naming the chord is naming the bottom note and the drill is the
 * reading quiz with two notes drawn on top -- confirmed by playing it, not
 * predicted. Inverting moves the root into the middle or the top of the stack,
 * so it has to be found; the `quality` step survives root position because
 * reading the bottom note and recalling its quality is one recall step more
 * than naming it.
 */
import {
  createMusicXmlFile,
  createSeededRng,
  keySignatureAlter,
  keySignatureTonic,
  xmlEscape,
} from './musicKeys'
import type { Pitch } from './musicKeys'
import { asMusicXmlPitch } from './musicKeys'
import { diatonicIndex, latinNameOf, pitchAtDiatonicIndex, STEPS } from './readingQuiz'
import { CHORD_ANSWER_STEPS } from '../types/chord'
import type {
  CatalogChord,
  ChordAccidentalMode,
  ChordAnswerStep,
  ChordClefMode,
  ChordInversion,
  ChordKey,
  ChordKeyMode,
  ChordMaterial,
  ChordNote,
  ChordQuality,
  ChordQuestion,
  ChordQuizSettings,
  ChordStackMode,
  ChordStaff,
} from '../types/chord'

export type {
  ChordAccidentalMode,
  ChordAnswerStep,
  ChordClefMode,
  ChordInversion,
  ChordKey,
  ChordKeyMode,
  ChordMaterial,
  ChordNote,
  ChordQuality,
  ChordQuestion,
  ChordQuizSettings,
  ChordStackMode,
  ChordStaff,
}

/** A key signature on its own: a catalog round knows the count, not the mode. */
export interface ChordSignature {
  fifths: number
  mode?: ChordKey['mode']
}

/** Where a catalog chord came from, for the caption under the staff. */
export interface ChordSource {
  title: string
  composer: string | null
  measure: number
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
  /**
   * What each question asks for, in order, already sanitized. Carried on the
   * round rather than re-read from the settings so the screen's step machine
   * and the generator's own material filter (`chordPlacements`) can never
   * disagree about what is being asked.
   */
  steps: ChordAnswerStep[]
  /**
   * The key the round is written in, or null for the keyless do major drill.
   * Drawn once per round, like a piece: a key changing every chord would turn
   * the drill into reading signatures instead of reading chords in one.
   * Also null in a catalog round, whose pieces say their signature but almost
   * never their mode -- see `fifths`.
   */
  key: ChordKey | null
  /**
   * The signature the round is written under: the key's, the catalog pieces'
   * own, or 0. What spells the name buttons and the score's `<key>`.
   */
  fifths: number
  /** Which material the round was actually drawn from. */
  material: ChordMaterial
  /**
   * Per question, the piece a catalog chord was found in (null for generated
   * chords). Parallel to `questions`, so `ChordQuestion` stays the plain
   * record a session stores.
   */
  sources: Array<ChordSource | null>
}

export const DEFAULT_CHORD_QUESTION_COUNT = 20

const DEFAULT_SETTINGS: ChordQuizSettings = {
  // Naming the chord is what reading a piece written on chords asks for, so it
  // is the step every round starts with; the quality and the played chord are
  // added on top of it rather than replacing it.
  answerSteps: ['root'],
  accidentalMode: 'none',
  keyMode: 'none',
  material: 'generated',
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

const ALTER_SIGNS: Record<number, string> = { [-1]: '♭', 0: '', 1: '♯' }

/**
 * "sol♯", the root as it is spoken: the letter carries its own accidental.
 *
 * These three labels live here rather than in the screen because the engine
 * needs them too (a played chord is recorded under its own name), and two
 * spellings of the same chord drifting apart between the screen and the stats
 * is exactly the kind of thing nobody notices for months.
 */
export function chordRootLabel(question: Pick<ChordQuestion, 'step' | 'rootAlter'>): string {
  return `${latinNameOf(question.step)}${ALTER_SIGNS[question.rootAlter] ?? ''}`
}

/** "si♭ major": a key, named the way the reveal names chords. */
export function chordKeyLabel(key: ChordKey | null): string {
  if (key === null) {
    return 'do major'
  }
  const tonic = keySignatureTonic(key.fifths, key.mode)
  return `${latinNameOf(tonic.step)}${ALTER_SIGNS[tonic.alter] ?? ''} ${key.mode}`
}

/**
 * What a root name button says in this key: "si♭" in si-flat major, "fa♯" in
 * sol major. Still one button per letter, and still answered by the letter --
 * the signature decides the rest, which is exactly what reading in a key means,
 * and a root-step round never draws a chord whose root departs from it.
 */
export function chordRootButtonLabel(step: string, fifths: number): string {
  return `${latinNameOf(step)}${ALTER_SIGNS[keySignatureAlter(fifths, step)] ?? ''}`
}

/** "2 flats", "1 sharp", "no sharps or flats": a signature with no mode. */
export function chordSignatureLabel(fifths: number): string {
  if (fifths === 0) {
    return 'no sharps or flats'
  }
  const count = Math.abs(fifths)
  return `${count} ${fifths > 0 ? 'sharp' : 'flat'}${count > 1 ? 's' : ''}`
}

/** "sol♯ minor": root then quality, which is the whole name of a chord. */
export function chordName(
  question: Pick<ChordQuestion, 'step' | 'rootAlter' | 'quality'>,
): string {
  return `${chordRootLabel(question)} ${chordQualityLabel(question.quality)}`
}

/** "sol – si♭ – re", bottom to top: the three keys, spelled. */
export function chordNotesLabel(question: Pick<ChordQuestion, 'notes'>): string {
  return question.notes
    .map((note) => `${latinNameOf(note.step)}${ALTER_SIGNS[note.alter] ?? ''}`)
    .join(' – ')
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
  rejectAwkward = true,
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
    if (Math.abs(alters[tone]) > 1 || (rejectAwkward && isAwkward(step, alters[tone]))) {
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
const NOTE_WINDOW: Record<ChordStaff, { low: number; high: number }> = {
  treble: { low: diatonicIndex('C', 4), high: diatonicIndex('A', 5) },
  bass: { low: diatonicIndex('E', 2), high: diatonicIndex('C', 4) },
}

/**
 * The same window as MIDI pitches, for the keyboard the `play` step answers on.
 *
 * It is the CLEF's register, not the chord's own range, and that is the point:
 * the step asks for the exact octave, so opening the keyboard on the three keys
 * being asked for would answer it. Derived from the window the generator draws
 * in rather than written out again, so the two cannot drift. Takes the staff of
 * the question rather than the round's mode: in a grand-staff round the clef is
 * visible on the score anyway, so following it gives nothing away.
 */
export function chordNoteWindowPitches(clef: ChordStaff): { low: number; high: number } {
  const window = NOTE_WINDOW[clef]
  return {
    low: pitchAtDiatonicIndex(window.low).midi,
    high: pitchAtDiatonicIndex(window.high).midi,
  }
}

/** The staves a round in this mode draws on. */
export function chordStavesOf(clefMode: ChordClefMode): ChordStaff[] {
  return clefMode === 'both' ? ['treble', 'bass'] : [clefMode]
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
function baseRootFor(clefMode: ChordStaff, inversion: ChordInversion): number | null {
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
  /**
   * True when the chord is one of the key's own seven, i.e. needs no written
   * accidental: in a keyless round, do major's seven.
   */
  diatonic: boolean
  /**
   * Whether the root is the letter as the key signature spells it -- always
   * the case unless the chord itself alters it (sol♯ in la minor). A round that
   * asks for the root draws only these, since the name buttons are spelled by
   * the signature.
   */
  rootInKey: boolean
  /** The chord's degree in the round's key ('IV', 'V/V'), or null when it has none. */
  numeral: string | null
  /** Relative frequency among the altered chords of a key; 1 everywhere else. */
  weight: number
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
const PLACEMENTS: Record<ChordStaff, ChordPlacement[]> = { treble: [], bass: [] }

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
          const diatonic = alters.every((alter) => alter === 0)
          PLACEMENTS[clefMode].push({
            stepIndex: root % STEPS.length,
            rootAlter,
            quality,
            inversion,
            root,
            alters,
            diatonic,
            rootInKey: rootAlter === 0,
            numeral: diatonic ? diatonicTriadOf(STEPS[root % STEPS.length]).degree : null,
            weight: 1,
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
 * which is exactly do major's seven. And a round that asks for the ROOT is
 * restricted to natural ones whatever the mode, because the seven name buttons
 * cannot say "fa sharp" -- a round that does not ask for it has no such limit,
 * so the quality-only and play-only rounds are where the whole material is in
 * play.
 */
export function chordPlacements(
  clef: ChordStaff,
  settings: Pick<ChordQuizSettings, 'stackMode' | 'accidentalMode' | 'answerSteps'>,
): ChordPlacement[] {
  return PLACEMENTS[clef].filter((entry) => {
    if (settings.stackMode === 'root' && entry.inversion !== 0) {
      return false
    }
    if (settings.accidentalMode === 'none' && !entry.diatonic) {
      return false
    }
    return !(settings.answerSteps.includes('root') && !entry.rootInKey)
  })
}

/**
 * The altered chords a key really uses, by degree (0 = tonic) and by how far
 * the root moves from the signature's own spelling.
 *
 * Chosen from what pieces actually contain rather than from every alteration
 * that is possible, because the drill exists to read real scores. In major:
 * the secondary dominants (V/V above all, then V/vi and V/ii), and the chords
 * borrowed from the minor (iv, ♭VII, ♭VI). In minor: the major V and the
 * diminished vii° that the raised leading note makes -- the commonest written
 * accidental in the whole repertoire, on nearly every page of a minor piece --
 * and the major IV of the melodic minor. `weight` is relative frequency among
 * them, so the V of a minor key comes up three times as often as its IV.
 */
interface KeyChord {
  degree: number
  rootShift: number
  quality: ChordQuality
  numeral: string
  weight: number
}

const ALTERED_KEY_CHORDS: Record<ChordKey['mode'], KeyChord[]> = {
  major: [
    { degree: 1, rootShift: 0, quality: 'major', numeral: 'V/V', weight: 2 },
    { degree: 2, rootShift: 0, quality: 'major', numeral: 'V/vi', weight: 1 },
    { degree: 5, rootShift: 0, quality: 'major', numeral: 'V/ii', weight: 1 },
    { degree: 3, rootShift: 0, quality: 'minor', numeral: 'iv', weight: 1 },
    { degree: 6, rootShift: -1, quality: 'major', numeral: '♭VII', weight: 1 },
    { degree: 5, rootShift: -1, quality: 'major', numeral: '♭VI', weight: 1 },
  ],
  minor: [
    { degree: 4, rootShift: 0, quality: 'major', numeral: 'V', weight: 3 },
    { degree: 6, rootShift: 1, quality: 'diminished', numeral: 'vii°', weight: 1 },
    { degree: 3, rootShift: 0, quality: 'major', numeral: 'IV', weight: 1 },
  ],
}

/**
 * How often a round in a key draws one of the key's own chords rather than an
 * altered one. Roughly what a page of a real piece looks like: mostly the
 * signature's own notes, with an accidental every few chords.
 */
const DIATONIC_SHARE = 0.75

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/** 'IV', 'ii', 'vii°': the degree, cased by quality as harmony writes it. */
function diatonicNumeral(degree: number, quality: ChordQuality): string {
  const roman = ROMAN[degree]
  if (quality === 'major') {
    return roman
  }
  if (quality === 'augmented') {
    return `${roman}+`
  }
  return quality === 'diminished' ? `${roman.toLowerCase()}°` : roman.toLowerCase()
}

/**
 * Every chord a round in `key` can draw on one staff: the same per-inversion
 * runs of seven root letters as the keyless drill (an alteration never moves a
 * note, so the window check is unchanged), each letter carrying the key's own
 * chord on that degree and, if the settings allow it, the altered ones.
 *
 * Spellings like mi♯ or si♯ are accepted here although the keyless drill
 * refuses them: inside a key they are what a score writes (the V of do-sharp
 * minor is sol♯-si♯-ré♯), so refusing them would be teaching a spelling that
 * real music does not use. Double accidentals are still left out.
 */
export function keyChordPlacements(
  clef: ChordStaff,
  key: ChordKey,
  settings: Pick<ChordQuizSettings, 'stackMode' | 'accidentalMode' | 'answerSteps'>,
): ChordPlacement[] {
  const tonicIndex = STEPS.indexOf(keySignatureTonic(key.fifths, key.mode).step)
  const placements: ChordPlacement[] = []
  for (const inversion of CHORD_INVERSIONS) {
    if (settings.stackMode === 'root' && inversion !== 0) {
      continue
    }
    const base = baseRootFor(clef, inversion)
    if (base === null) {
      continue
    }
    for (let offset = 0; offset < STEPS.length; offset += 1) {
      const root = base + offset
      const stepIndex = root % STEPS.length
      const degree = (stepIndex - tonicIndex + STEPS.length) % STEPS.length
      const letterAlter = (index: number) =>
        keySignatureAlter(key.fifths, STEPS[index % STEPS.length])
      const signature: [number, number, number] = [
        letterAlter(root),
        letterAlter(root + 2),
        letterAlter(root + 4),
      ]
      const add = (quality: ChordQuality, rootShift: number, numeral: string | null, weight: number) => {
        const rootAlter = signature[0] + rootShift
        const alters = spellTriad(root, rootAlter, quality, false)
        if (alters === null) {
          return
        }
        const diatonic = alters.every((alter, tone) => alter === signature[tone])
        placements.push({
          stepIndex,
          rootAlter,
          quality,
          inversion,
          root,
          alters,
          diatonic,
          rootInKey: rootShift === 0,
          numeral: numeral ?? diatonicNumeral(degree, quality),
          weight,
        })
      }
      // The key's own chord on this degree: whichever quality the signature's
      // three letters already spell.
      const own = QUALITY_ORDER.find((quality) => {
        const alters = spellTriad(root, signature[0], quality, false)
        return alters !== null && alters.every((alter, tone) => alter === signature[tone])
      })
      if (own !== undefined) {
        add(own, 0, null, 1)
      }
      if (settings.accidentalMode === 'all') {
        for (const chord of ALTERED_KEY_CHORDS[key.mode]) {
          if (chord.degree === degree) {
            add(chord.quality, chord.rootShift, chord.numeral, chord.weight)
          }
        }
      }
    }
  }
  return placements.filter(
    (entry) => !(settings.answerSteps.includes('root') && !entry.rootInKey),
  )
}

/**
 * The signatures a round with a random key draws from when the catalog cannot
 * say: up to four sharps or flats, which is where nearly every beginner and
 * intermediate piece sits.
 */
const FALLBACK_KEY_FIFTHS = [-4, -3, -2, -1, 0, 1, 2, 3, 4]

/**
 * Six sharps or flats is as far as the drill goes: seven-sign keys exist
 * mostly as respellings of the six-sign ones, and the catalog holds next to
 * none.
 */
const MAX_KEY_FIFTHS = 6

/**
 * One key for a round: a signature weighted by how many catalog scores open
 * in it (`counts`, keyed by fifths), and major or minor at even odds -- a file
 * almost never states which of its signature's two keys it is in, so the
 * catalog cannot weight that half.
 */
export function drawChordKey(
  rng: () => number,
  counts: Record<string, number> | null | undefined,
): ChordKey {
  const weighted = Object.entries(counts ?? {})
    .map(([fifths, count]) => ({ fifths: Number(fifths), count }))
    .filter(
      (entry) =>
        Number.isInteger(entry.fifths) && Math.abs(entry.fifths) <= MAX_KEY_FIFTHS && entry.count > 0,
    )
  const pool =
    weighted.length > 0
      ? weighted
      : FALLBACK_KEY_FIFTHS.map((fifths) => ({ fifths, count: 1 }))
  const total = pool.reduce((sum, entry) => sum + entry.count, 0)
  let target = rng() * total
  let fifths = pool[pool.length - 1].fifths
  for (const entry of pool) {
    target -= entry.count
    if (target < 0) {
      fifths = entry.fifths
      break
    }
  }
  return { fifths, mode: rng() < 0.5 ? 'major' : 'minor' }
}

/** The seven root-position roots, lowest first. Used by the lesson's table. */
export function chordRoots(clef: ChordStaff): number[] {
  return [
    ...new Set(
      chordPlacements(clef, {
        stackMode: 'root',
        accidentalMode: 'none',
        answerSteps: ['root'],
      }).map((entry) => entry.root),
    ),
  ].sort((a, b) => a - b)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * The steps in canonical order, deduplicated, never empty.
 *
 * The order is the generator's, not the caller's: the root is found before the
 * quality can be measured on an inverted stack, and the chord cannot be played
 * before it is named. A checkbox list has no order of its own to respect, and
 * an empty one is a round that asks nothing -- which falls back to the root.
 */
function sanitizeSteps(steps: ChordAnswerStep[] | undefined): ChordAnswerStep[] {
  const wanted = new Set(steps ?? [])
  const ordered = CHORD_ANSWER_STEPS.filter((step) => wanted.has(step))
  return ordered.length > 0 ? ordered : ['root']
}

function sanitize(settings: Partial<ChordQuizSettings>): ChordQuizSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return {
    ...merged,
    answerSteps: sanitizeSteps(merged.answerSteps),
    questionCount: clamp(Math.round(merged.questionCount), 1, 60),
  }
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
export function triadNotes(placement: Pick<ChordPlacement, 'inversion' | 'root' | 'alters'>): ChordNote[] {
  const offsets = STACK_OFFSETS[placement.inversion]
  const tones = STACK_TONES[placement.inversion]
  return offsets.map((offset, i) => noteAt(placement.root + offset, placement.alters[tones[i]]))
}

/** The plain diatonic triad on a root index, for the lesson's own table. */
export function triadAt(rootIndex: number, inversion: ChordInversion = 0): ChordNote[] {
  return triadNotes({ inversion, root: rootIndex, alters: [0, 0, 0] })
}

function weightedPick(rng: () => number, placements: ChordPlacement[]): ChordPlacement {
  const total = placements.reduce((sum, entry) => sum + entry.weight, 0)
  let target = rng() * total
  for (const entry of placements) {
    target -= entry.weight
    if (target < 0) {
      return entry
    }
  }
  return placements[placements.length - 1]
}

/**
 * One chord out of a staff's material. Keyless, every placement is equally
 * likely, as it always was. In a key, the key's own chords and the altered ones
 * are two pools drawn at `DIATONIC_SHARE`: drawing from one pool would let
 * the altered chords -- several per degree -- outnumber the key's own seven,
 * which is the opposite of what a page of music looks like.
 */
function pickPlacement(rng: () => number, placements: ChordPlacement[], key: ChordKey | null): ChordPlacement {
  if (key === null) {
    return placements[Math.floor(rng() * placements.length)]
  }
  const own = placements.filter((entry) => entry.diatonic)
  const altered = placements.filter((entry) => !entry.diatonic)
  const pool = altered.length > 0 && (own.length === 0 || rng() >= DIATONIC_SHARE) ? altered : own
  return weightedPick(rng, pool)
}

/** The material a round draws from on one staff, with or without a key. */
function roundPlacements(clef: ChordStaff, settings: ChordQuizSettings, key: ChordKey | null): ChordPlacement[] {
  return key === null ? chordPlacements(clef, settings) : keyChordPlacements(clef, key, settings)
}

function pickQuestions(settings: ChordQuizSettings, key: ChordKey | null): ChordQuestion[] {
  const rng = createSeededRng(settings.seed)
  const staves = chordStavesOf(settings.clefMode)
  const placementsByStaff = Object.fromEntries(
    staves.map((clef) => [clef, roundPlacements(clef, settings, key)]),
  ) as Record<ChordStaff, ChordPlacement[]>
  const questions: ChordQuestion[] = []
  let previousStepIndex = -1
  for (let i = 0; i < settings.questionCount; i += 1) {
    // A grand-staff round picks the staff first, evenly, so the bass clef is
    // not outnumbered by whichever staff happens to have more placements.
    const clef = staves.length > 1 ? staves[Math.floor(rng() * staves.length)] : staves[0]
    const placements = placementsByStaff[clef]
    // Never the same CHORD twice running (whatever its inversion): the answer
    // would be free, and a repeat reads as the screen having failed to advance.
    // Two inversions of the same chord back to back would also turn the second
    // into a free one, which is precisely the shortcut this drill is about.
    let placement = pickPlacement(rng, placements, key)
    for (let attempt = 0; attempt < 8 && placement.stepIndex === previousStepIndex; attempt += 1) {
      placement = pickPlacement(rng, placements, key)
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
      // A degree names a chord's place in a key: in a keyless round only do
      // major's own seven have one, since sol minor would need a key this round
      // is not in. With a key, every chord drawn was chosen by its degree.
      degree: placement.numeral,
      inversion: placement.inversion,
      clef,
    })
  }
  return questions
}

/**
 * Every quality a round with these settings can draw, in the buttons' own order.
 *
 * Read from the very placements the round draws from, not from do major's
 * table: with accidentals on, augmented chords are in the material, and a
 * table-derived list once left them without a button, so re-fa sharp-la sharp
 * could only ever be answered wrong.
 */
export function chordQualitiesInPlay(
  clefMode: ChordClefMode,
  settings: Pick<ChordQuizSettings, 'stackMode' | 'accidentalMode' | 'answerSteps'>,
): ChordQuality[] {
  const present = new Set(
    chordStavesOf(clefMode).flatMap((clef) =>
      chordPlacements(clef, settings).map((entry) => entry.quality),
    ),
  )
  return QUALITY_ORDER.filter((quality) => present.has(quality))
}

const ACCIDENTAL_NAMES: Record<number, string> = { [-1]: 'flat', 0: 'natural', 1: 'sharp' }

function noteXml(note: ChordNote, isChordTone: boolean, staff: 1 | 2 | null, fifths: number): string {
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
  // emitted explicitly rather than left to the renderer to infer. A sign is
  // printed exactly when the note departs from the key signature: a mi-flat in
  // si-flat major carries none, a mi-natural there carries a natural. With no
  // signature that is every altered note, as before.
  const accidental =
    note.alter !== keySignatureAlter(fifths, note.step)
      ? `\n        <accidental>${ACCIDENTAL_NAMES[note.alter]}</accidental>`
      : ''
  return `      <note>${chord}
        ${asMusicXmlPitch(pitch)}
        <duration>4</duration>
        <voice>${staff ?? 1}</voice>
        <type>whole</type>${accidental}${staff === null ? '' : `\n        <staff>${staff}</staff>`}
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

function attributesXml(clefMode: ChordClefMode, key: ChordSignature | null): string {
  const keyXml =
    key === null
      ? `        <key>
          <fifths>0</fifths>
        </key>`
      : `        <key>
          <fifths>${key.fifths}</fifths>${key.mode ? `\n          <mode>${key.mode}</mode>` : ''}
        </key>`
  const time = `        <divisions>1</divisions>
${keyXml}
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

function measureXml(question: ChordQuestion, clefMode: ChordClefMode, key: ChordSignature | null): string {
  const attributes = question.measureNumber === 1 ? `\n${attributesXml(clefMode, key)}\n` : '\n'
  const fifths = key?.fifths ?? 0
  if (clefMode !== 'both') {
    const notes = question.notes
      .map((note, index) => noteXml(note, index > 0, null, fifths))
      .join('\n')
    return `    <measure number="${question.measureNumber}">${attributes}${notes}
    </measure>`
  }
  // Grand staff: the chord goes on its own clef's staff and the other staff
  // carries a whole rest, as in the reading quiz, so the round reads like a
  // real piano score rather than switching clef every measure on one staff.
  const staff = question.clef === 'treble' ? 1 : 2
  const chord = question.notes
    .map((note, index) => noteXml(note, index > 0, staff, fifths))
    .join('\n')
  return `    <measure number="${question.measureNumber}">${attributes}${
    staff === 1 ? chord : restXml(1)
  }
      <backup>
        <duration>4</duration>
      </backup>
${staff === 2 ? chord : restXml(2)}
    </measure>`
}

export function generateChordQuizMusicXml(
  questions: ChordQuestion[],
  clefMode: ChordClefMode,
  key: ChordSignature | null = null,
): string {
  const measures = questions.map((question) => measureXml(question, clefMode, key)).join('\n')
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

/**
 * A catalog chord as a placement on one staff: the same per-inversion run of
 * root letters as every other chord, so it lands in the same window, stacked
 * close with its own bottom tone and its own spelling. Null when it would need
 * a double accidental, which no other chord of the drill draws either.
 */
export function catalogChordPlacement(clef: ChordStaff, chord: CatalogChord): ChordPlacement | null {
  const base = baseRootFor(clef, chord.inversion)
  const stepIndex = STEPS.indexOf(chord.rootStep)
  if (base === null || stepIndex < 0 || chord.alters.some((alter) => Math.abs(alter) > 1)) {
    return null
  }
  const root = base + ((stepIndex - (base % STEPS.length) + STEPS.length) % STEPS.length)
  const signature = [0, 2, 4].map((offset) =>
    keySignatureAlter(chord.fifths, STEPS[(root + offset) % STEPS.length]),
  )
  return {
    stepIndex,
    rootAlter: chord.alters[0],
    quality: chord.quality,
    inversion: chord.inversion,
    root,
    alters: [...chord.alters],
    diatonic: chord.alters.every((alter, tone) => alter === signature[tone]),
    rootInKey: chord.alters[0] === signature[0],
    // The pieces say their signature, not their mode, so a degree would be a
    // guess at which of the signature's two keys the piece is in.
    numeral: null,
    weight: 1,
  }
}

/** The catalog chords a round with these settings may ask, before any signature is chosen. */
export function eligibleCatalogChords(
  chords: CatalogChord[],
  settings: Pick<ChordQuizSettings, 'stackMode' | 'answerSteps'>,
): CatalogChord[] {
  return chords.filter((chord) => {
    if (settings.stackMode === 'root' && chord.inversion !== 0) {
      return false
    }
    const placement = catalogChordPlacement('treble', chord)
    // Same rule as the generated material: the name buttons are spelled by the
    // signature, so a root departing from it cannot be named.
    return placement !== null && !(settings.answerSteps.includes('root') && !placement.rootInKey)
  })
}

/**
 * A round of chords found in the catalog's pieces.
 *
 * One signature per round, like a keyed round, chosen by how many usable
 * chords sit under it. Within it, a piece is picked first and then a chord in
 * it, rather than a chord straight from the pool: a handful of pieces hold most
 * of the catalog's block chords, and drawing from the pool would hand them
 * nearly every question.
 */
function pickCatalogQuestions(
  settings: ChordQuizSettings,
  chords: CatalogChord[],
): { fifths: number; questions: ChordQuestion[]; sources: ChordSource[] } {
  const rng = createSeededRng(settings.seed)
  const bySignature = new Map<number, CatalogChord[]>()
  for (const chord of chords) {
    bySignature.set(chord.fifths, [...(bySignature.get(chord.fifths) ?? []), chord])
  }
  const signatures = [...bySignature.entries()].sort((a, b) => a[0] - b[0])
  let target = rng() * chords.length
  let [fifths, pool] = signatures[signatures.length - 1]
  for (const [candidate, entries] of signatures) {
    target -= entries.length
    if (target < 0) {
      fifths = candidate
      pool = entries
      break
    }
  }
  const byScore = new Map<string, CatalogChord[]>()
  for (const chord of pool) {
    byScore.set(chord.scoreId, [...(byScore.get(chord.scoreId) ?? []), chord])
  }
  const pieces = [...byScore.values()]
  const draw = () => {
    const piece = pieces[Math.floor(rng() * pieces.length)]
    return piece[Math.floor(rng() * piece.length)]
  }
  const staves = chordStavesOf(settings.clefMode)
  const questions: ChordQuestion[] = []
  const sources: ChordSource[] = []
  let previousStep: string | null = null
  for (let i = 0; i < settings.questionCount; i += 1) {
    const clef = staves.length > 1 ? staves[Math.floor(rng() * staves.length)] : staves[0]
    // Never the same chord twice running, as in the generated rounds. A pool
    // with a single chord has no choice, and repeats rather than ending early.
    let chord = draw()
    for (let attempt = 0; attempt < 8 && chord.rootStep === previousStep; attempt += 1) {
      chord = draw()
    }
    previousStep = chord.rootStep
    // Eligibility was checked on the treble staff, and the window check is
    // the same for both: a placement only fails on a double accidental.
    const placement = catalogChordPlacement(clef, chord) as ChordPlacement
    questions.push({
      index: i,
      measureNumber: i + 1,
      step: chord.rootStep,
      rootAlter: placement.rootAlter,
      notes: triadNotes(placement),
      quality: placement.quality,
      degree: null,
      inversion: placement.inversion,
      clef,
    })
    sources.push({ title: chord.title, composer: chord.composer, measure: chord.measure })
  }
  return { fifths, questions, sources }
}

/**
 * What a round may need from the server, fetched by the setup screen: the
 * catalog's key signature statistic (`GET /api/key-signatures`) for a random
 * key, and its chords (`GET /api/chords`) for catalog material. Either may be
 * null. A random key then falls back to an even spread of the common keys;
 * catalog material with no usable chord falls back to generated chords, and
 * `ChordRound.material` says so.
 */
export interface ChordRoundInputs {
  keyCounts: Record<string, number> | null
  catalogChords: CatalogChord[] | null
}

const NO_INPUTS: ChordRoundInputs = { keyCounts: null, catalogChords: null }

/** A whole round. */
export function createChordRound(
  settings: Partial<ChordQuizSettings>,
  inputs: ChordRoundInputs = NO_INPUTS,
): ChordRound {
  const sanitized = sanitize(settings)
  if (sanitized.material === 'catalog') {
    const chords = eligibleCatalogChords(inputs.catalogChords ?? [], sanitized)
    if (chords.length > 0) {
      const { fifths, questions, sources } = pickCatalogQuestions(sanitized, chords)
      const present = new Set(chords.filter((chord) => chord.fifths === fifths).map((chord) => chord.quality))
      return {
        questions,
        file: createMusicXmlFile(
          generateChordQuizMusicXml(questions, sanitized.clefMode, { fifths }),
          'chord-quiz',
        ),
        // From the signature's whole pool rather than the questions drawn, so
        // the buttons do not tell the player which qualities are coming.
        qualities: QUALITY_ORDER.filter((quality) => present.has(quality)),
        nameOrder: [...STEPS],
        steps: sanitized.answerSteps,
        key: null,
        fifths,
        material: 'catalog',
        sources,
      }
    }
  }
  const keyCounts = inputs.keyCounts
  // Its own stream, so turning keys on does not reshuffle which chords a seed
  // draws for reasons that have nothing to do with the key.
  const key =
    sanitized.keyMode === 'random'
      ? drawChordKey(createSeededRng(`${sanitized.seed}:key`), keyCounts)
      : null
  const questions = pickQuestions(sanitized, key)
  return {
    questions,
    file: createMusicXmlFile(
      generateChordQuizMusicXml(questions, sanitized.clefMode, key),
      'chord-quiz',
    ),
    qualities: key === null ? chordQualitiesInPlay(sanitized.clefMode, sanitized) : keyQualitiesInPlay(),
    nameOrder: [...STEPS],
    steps: sanitized.answerSteps,
    key,
    fifths: key?.fifths ?? 0,
    material: 'generated',
    sources: questions.map(() => null),
  }
}

/**
 * The quality buttons of a round with a key. The same three whatever the key
 * and whatever the accidentals setting: every key has its major, minor and
 * diminished chords, and the altered chords it uses add no augmented one. Fixed
 * rather than read from the drawn key so the buttons cannot hint at it.
 */
function keyQualitiesInPlay(): ChordQuality[] {
  return ['major', 'minor', 'diminished']
}
