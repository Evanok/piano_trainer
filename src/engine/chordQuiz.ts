/**
 * The chord-reading drill: draw a triad on a staff, and say which chord it is.
 *
 * Built like the reading quiz: the whole round is ONE MusicXML score with one
 * chord per measure, and the screen moves between questions by cropping to a
 * single measure (`ReadingStaff`), so this file only has to emit measures.
 *
 * Every material goes through the same pipeline: it produces `SpelledChord`s
 * (a chord as written -- root letter, alterations, bottom tone, signature),
 * `askable` applies the settings that are the same for all of them,
 * `drawQuestions` picks the round, and `placeChord` stacks each chord on its
 * staff. The three materials differ only in what they produce:
 *
 * - **do major, no signature** -- every root letter, natural or altered, in
 *   every quality that spells readably. With accidentals off this is do
 *   major's seven, where the quality follows from the letter (recitable from a
 *   table, which is why accidentals are the real drill).
 * - **a key** -- the key's own seven chords plus, with accidentals on, the
 *   altered chords pieces really use there, drawn at `DIATONIC_SHARE`.
 * - **the catalog** -- the triads found written in library scores, one
 *   signature per round, piece first and chord second.
 *
 * Root position alone makes the `root` step worthless (the root is then the
 * bottom note), which is why the default inverts.
 */
import {
  asMusicXmlPitch,
  createMusicXmlFile,
  createSeededRng,
  keySignatureAlter,
  keySignatureTonic,
  xmlEscape,
} from './musicKeys'
import type { Pitch } from './musicKeys'
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

/** Where a catalog chord came from, for the caption above the staff. */
export interface ChordSource {
  title: string
  composer: string | null
  measure: number
}

/** One chord as written, whatever material it comes from. */
export interface SpelledChord {
  /** The root's letter, C..B. */
  rootStep: string
  /** Alteration of the root, the third and the fifth. */
  alters: [number, number, number]
  quality: ChordQuality
  inversion: ChordInversion
  /** The signature it is written under. */
  fifths: number
  /** Its degree in the round's key ('IV', 'V/V'), or null when it has none. */
  numeral: string | null
  /** Drawn by group first (`ChordMaterialSet.groupWeights`), then by weight. */
  group: string
  weight: number
  source: ChordSource | null
}

/** A chord stacked on a staff: `root` is the diatonic index of its root letter. */
export interface ChordPlacement extends SpelledChord {
  clef: ChordStaff
  root: number
}

export interface ChordRound {
  questions: ChordQuestion[]
  file: File
  /**
   * The quality buttons, from the round's whole material rather than from the
   * questions drawn, so they never tell the player what is coming.
   */
  qualities: ChordQuality[]
  /** The seven name buttons, in scale order (no shuffle: see CLAUDE.md). */
  nameOrder: string[]
  /** What each question asks for, sanitized: the screen's step machine reads it. */
  steps: ChordAnswerStep[]
  /** The round's key, null without one -- and in a catalog round, whose pieces state no mode. */
  key: ChordKey | null
  /** The signature the round is written under, which spells the name buttons. */
  fifths: number
  /** The material actually used: a catalog round with nothing usable falls back to `generated`. */
  material: ChordMaterial
  /** Per question, where a catalog chord was found (null for generated chords). */
  sources: Array<ChordSource | null>
}

const DEFAULT_SETTINGS: ChordQuizSettings = {
  answerSteps: ['root'],
  accidentalMode: 'none',
  keyMode: 'none',
  material: 'generated',
  stackMode: 'all',
  clefMode: 'treble',
  questionCount: 20,
  seed: 'chords',
}

/** The canonical order the quality buttons are drawn in, commonest first. */
const QUALITY_ORDER: ChordQuality[] = ['major', 'minor', 'diminished', 'augmented']

export function chordQualityLabel(quality: ChordQuality): string {
  return quality
}

const ALTER_SIGNS: Record<number, string> = { [-1]: '♭', 0: '', 1: '♯' }

/** "sol♯", the root as it is spoken. */
export function chordRootLabel(question: Pick<ChordQuestion, 'step' | 'rootAlter'>): string {
  return `${latinNameOf(question.step)}${ALTER_SIGNS[question.rootAlter] ?? ''}`
}

/** "si♭ major". */
export function chordKeyLabel(key: ChordKey | null): string {
  if (key === null) {
    return 'do major'
  }
  const tonic = keySignatureTonic(key.fifths, key.mode)
  return `${latinNameOf(tonic.step)}${ALTER_SIGNS[tonic.alter] ?? ''} ${key.mode}`
}

/** A root name button, spelled by the signature: "si♭" in si-flat major. Answered by the letter. */
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

/** "sol♯ minor". */
export function chordName(question: Pick<ChordQuestion, 'step' | 'rootAlter' | 'quality'>): string {
  return `${chordRootLabel(question)} ${chordQualityLabel(question.quality)}`
}

/** "sol – si♭ – re", bottom to top. */
export function chordNotesLabel(question: Pick<ChordQuestion, 'notes'>): string {
  return question.notes.map((note) => `${latinNameOf(note.step)}${ALTER_SIGNS[note.alter] ?? ''}`).join(' – ')
}

/**
 * Semitones from the root to the third and to the fifth: the definition of the
 * four qualities. The first number is the rule the lesson teaches (4 major, 3
 * minor); the second only separates diminished and augmented.
 */
const QUALITY_INTERVALS: Record<ChordQuality, [number, number]> = {
  major: [4, 7],
  minor: [3, 7],
  diminished: [3, 6],
  augmented: [4, 8],
}

/** The gap between the three notes, for the lesson's table. */
export function chordQualitySemitones(quality: ChordQuality): [number, number] {
  const [third, fifth] = QUALITY_INTERVALS[quality]
  return [third, fifth - third]
}

/** Do major's seven, which name the degrees of the keyless material. */
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

const NATURAL_PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * Notes the keyless drill never writes: an alteration across a natural
 * half-step (mi♯ sounds as fa). Inside a key they are what a score writes, so
 * only the keyless material refuses them.
 */
const AWKWARD_SPELLINGS = new Set(['E1', 'B1', 'F-1', 'C-1'])

/**
 * The alterations of a triad's three tones. The letters are fixed by the stack
 * (a letter, the one two above, the one four above), so a quality is obtained
 * by altering them, never by changing a letter. Null when a tone would need a
 * double accidental (or, with `rejectAwkward`, an awkward spelling).
 */
function spellTriad(
  rootStep: string,
  rootAlter: number,
  quality: ChordQuality,
  rejectAwkward: boolean,
): [number, number, number] | null {
  const rootIndex = STEPS.indexOf(rootStep)
  const steps = [0, 2, 4].map((offset) => STEPS[(rootIndex + offset) % STEPS.length])
  const natural = (step: string) => (NATURAL_PITCH_CLASS[step] - NATURAL_PITCH_CLASS[rootStep] + 12) % 12
  const [thirdSemis, fifthSemis] = QUALITY_INTERVALS[quality]
  const alters: [number, number, number] = [
    rootAlter,
    thirdSemis - natural(steps[1]) + rootAlter,
    fifthSemis - natural(steps[2]) + rootAlter,
  ]
  const unreadable = alters.some(
    (alter, tone) => Math.abs(alter) > 1 || (rejectAwkward && AWKWARD_SPELLINGS.has(`${steps[tone]}${alter}`)),
  )
  return unreadable ? null : alters
}

/** The signature's own alteration on each tone of a chord built on `rootStep`. */
function signatureAlters(rootStep: string, fifths: number): [number, number, number] {
  const rootIndex = STEPS.indexOf(rootStep)
  const alter = (offset: number) => keySignatureAlter(fifths, STEPS[(rootIndex + offset) % STEPS.length])
  return [alter(0), alter(2), alter(4)]
}

/** Whether a chord needs no written accidental under its signature. */
export function isOwnChord(chord: Pick<SpelledChord, 'rootStep' | 'alters' | 'fifths'>): boolean {
  const signature = signatureAlters(chord.rootStep, chord.fifths)
  return chord.alters.every((alter, tone) => alter === signature[tone])
}

/** Whether the root is spelled as the signature spells its letter, so a name button can say it. */
export function hasRootInKey(chord: Pick<SpelledChord, 'rootStep' | 'alters' | 'fifths'>): boolean {
  return chord.alters[0] === keySignatureAlter(chord.fifths, chord.rootStep)
}

/**
 * Every note a round may draw, per clef: the staff plus one ledger line either
 * side. Past that a cropped measure starts clipping.
 */
const NOTE_WINDOW: Record<ChordStaff, { low: number; high: number }> = {
  treble: { low: diatonicIndex('C', 4), high: diatonicIndex('A', 5) },
  bass: { low: diatonicIndex('E', 2), high: diatonicIndex('C', 4) },
}

/**
 * The clef's register as MIDI pitches, for the `play` step's keyboard. The
 * clef's, not the chord's: opening on the three keys asked for would answer
 * the step, which judges the exact octave.
 */
export function chordNoteWindowPitches(clef: ChordStaff): { low: number; high: number } {
  const window = NOTE_WINDOW[clef]
  return { low: pitchAtDiatonicIndex(window.low).midi, high: pitchAtDiatonicIndex(window.high).midi }
}

function stavesOf(clefMode: ChordClefMode): ChordStaff[] {
  return clefMode === 'both' ? ['treble', 'bass'] : [clefMode]
}

/**
 * Where the three drawn notes sit relative to the root's letter, per
 * inversion, in diatonic steps. An inversion opens one fourth-wide gap in the
 * stack, and the note just above it is the root (the rule the lesson
 * teaches). For inversions 1 and 2 the root appears an octave up, at +7.
 */
const STACK_OFFSETS: Record<ChordInversion, [number, number, number]> = {
  0: [0, 2, 4],
  1: [2, 4, 7],
  2: [4, 7, 9],
}

/** Which tone (root, third, fifth) each drawn note is, parallel to STACK_OFFSETS. */
const STACK_TONES: Record<ChordInversion, [number, number, number]> = {
  0: [0, 1, 2],
  1: [1, 2, 0],
  2: [2, 0, 1],
}

export const CHORD_INVERSIONS: ChordInversion[] = [0, 1, 2]

export function chordInversionLabel(inversion: ChordInversion): string {
  return inversion === 0 ? 'root position' : inversion === 1 ? '1st inversion' : '2nd inversion'
}

/**
 * The lowest root each (clef, inversion) draws from; the seven roots are that
 * one and the six above it, so an inversion's chords form one ascending run.
 * Per inversion because an inverted stack is taller; the run is centred in the
 * clef's window (centring each chord on its own put the do chord an octave
 * above the other six).
 */
function baseRootFor(clef: ChordStaff, inversion: ChordInversion): number {
  const { low, high } = NOTE_WINDOW[clef]
  const [bottom, , top] = STACK_OFFSETS[inversion]
  const center = (low + high) / 2
  let best = low
  let bestDistance = Number.POSITIVE_INFINITY
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

/** A chord on a staff: its root letter's position in that inversion's run. */
export function placeChord(clef: ChordStaff, chord: SpelledChord): ChordPlacement {
  const base = baseRootFor(clef, chord.inversion)
  const offset = (STEPS.indexOf(chord.rootStep) - (base % STEPS.length) + STEPS.length) % STEPS.length
  return { ...chord, clef, root: base + offset }
}

/** The seven root-position roots of a clef, lowest first, for the lesson's table. */
export function chordRoots(clef: ChordStaff): number[] {
  const base = baseRootFor(clef, 0)
  return STEPS.map((_, offset) => base + offset)
}

/** The drawn notes of a placement, bottom to top. */
export function triadNotes(placement: Pick<ChordPlacement, 'inversion' | 'root' | 'alters'>): ChordNote[] {
  const tones = STACK_TONES[placement.inversion]
  return STACK_OFFSETS[placement.inversion].map((offset, i) => {
    const pitch = pitchAtDiatonicIndex(placement.root + offset)
    const alter = placement.alters[tones[i]]
    return { midi: pitch.midi + alter, step: pitch.step, alter, octave: pitch.octave }
  })
}

/** The plain diatonic triad on a root index, for the lesson. */
export function triadAt(rootIndex: number, inversion: ChordInversion = 0): ChordNote[] {
  return triadNotes({ inversion, root: rootIndex, alters: [0, 0, 0] })
}

/**
 * The altered chords a key really uses, by degree (0 = tonic) and by how far
 * the root moves from the signature's spelling. In major: the secondary
 * dominants and the chords borrowed from the minor. In minor: the major V and
 * the vii° of the raised leading note (the commonest written accidental in the
 * repertoire), and the major IV of the melodic minor. `weight` is relative
 * frequency among them.
 */
const ALTERED_KEY_CHORDS: Record<ChordKey['mode'], Array<{
  degree: number
  rootShift: number
  quality: ChordQuality
  numeral: string
  weight: number
}>> = {
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

/** How often a keyed round draws one of the key's own chords: roughly a page of real music. */
const DIATONIC_SHARE = 0.75

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

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

function spelled(
  rootStep: string,
  alters: [number, number, number],
  quality: ChordQuality,
  fifths: number,
  extra: Pick<SpelledChord, 'numeral' | 'group' | 'weight' | 'source'>,
): SpelledChord[] {
  return CHORD_INVERSIONS.map((inversion) => ({ rootStep, alters, quality, inversion, fifths, ...extra }))
}

/** Do major's material, no signature: every readable spelling on every letter. */
export function keylessChords(accidentalMode: ChordAccidentalMode): SpelledChord[] {
  return STEPS.flatMap((rootStep) =>
    [0, -1, 1].flatMap((rootAlter) =>
      QUALITY_ORDER.flatMap((quality) => {
        const alters = spellTriad(rootStep, rootAlter, quality, true)
        const own = alters !== null && alters.every((alter) => alter === 0)
        if (alters === null || (accidentalMode === 'none' && !own)) {
          return []
        }
        const numeral = own ? diatonicTriadOf(rootStep).degree : null
        return spelled(rootStep, alters, quality, 0, { numeral, group: 'all', weight: 1, source: null })
      }),
    ),
  )
}

/** A key's material: its own seven chords, plus the altered ones with accidentals on. */
export function keyChords(key: ChordKey, accidentalMode: ChordAccidentalMode): SpelledChord[] {
  const tonicIndex = STEPS.indexOf(keySignatureTonic(key.fifths, key.mode).step)
  return STEPS.flatMap((rootStep, letter) => {
    const degree = (letter - tonicIndex + STEPS.length) % STEPS.length
    const signature = signatureAlters(rootStep, key.fifths)
    const own = QUALITY_ORDER.find((quality) => {
      const alters = spellTriad(rootStep, signature[0], quality, false)
      return alters !== null && alters.every((alter, tone) => alter === signature[tone])
    })
    const chords =
      own === undefined
        ? []
        : spelled(rootStep, signature, own, key.fifths, {
            numeral: diatonicNumeral(degree, own),
            group: 'own',
            weight: 1,
            source: null,
          })
    if (accidentalMode === 'all') {
      for (const altered of ALTERED_KEY_CHORDS[key.mode]) {
        const alters =
          altered.degree === degree ? spellTriad(rootStep, signature[0] + altered.rootShift, altered.quality, false) : null
        if (alters) {
          chords.push(
            ...spelled(rootStep, alters, altered.quality, key.fifths, {
              numeral: altered.numeral,
              group: 'altered',
              weight: altered.weight,
              source: null,
            }),
          )
        }
      }
    }
    return chords
  })
}

/** Catalog chords as spelled chords, one draw group per piece. */
function fromCatalog(chords: CatalogChord[]): SpelledChord[] {
  return chords.map((chord) => ({
    rootStep: chord.rootStep,
    alters: chord.alters,
    quality: chord.quality,
    inversion: chord.inversion,
    fifths: chord.fifths,
    // The pieces state their signature but not their mode, so a degree would be a guess.
    numeral: null,
    group: chord.scoreId,
    weight: 1,
    source: { title: chord.title, composer: chord.composer, measure: chord.measure },
  }))
}

/**
 * The settings every material obeys: root position only when asked, and no
 * root the name buttons cannot say (they are spelled by the signature). Double
 * accidentals are left out everywhere.
 */
export function askable(chord: SpelledChord, settings: Pick<ChordQuizSettings, 'stackMode' | 'answerSteps'>): boolean {
  if (settings.stackMode === 'root' && chord.inversion !== 0) {
    return false
  }
  if (chord.alters.some((alter) => Math.abs(alter) > 1)) {
    return false
  }
  return !(settings.answerSteps.includes('root') && !hasRootInKey(chord))
}

/** The catalog chords a round with these settings may ask, across every signature. */
export function usableCatalogChords(
  chords: CatalogChord[],
  settings: Pick<ChordQuizSettings, 'stackMode' | 'answerSteps'>,
): CatalogChord[] {
  return chords.filter((chord) => askable(fromCatalog([chord])[0], settings))
}

/** Fallback when the catalog cannot say: up to four signs, where most pieces sit. */
const FALLBACK_KEY_FIFTHS = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
const MAX_KEY_FIFTHS = 6

function weightedPick<T>(rng: () => number, items: T[], weightOf: (item: T) => number): T {
  let target = rng() * items.reduce((sum, item) => sum + weightOf(item), 0)
  for (const item of items) {
    target -= weightOf(item)
    if (target < 0) {
      return item
    }
  }
  return items[items.length - 1]
}

/**
 * A round's key: a signature weighted by how many catalog scores open in it
 * (`counts`, keyed by fifths), major or minor at even odds since a file almost
 * never says which of its signature's two keys it is in.
 */
export function drawChordKey(rng: () => number, counts: Record<string, number> | null | undefined): ChordKey {
  const weighted = Object.entries(counts ?? {})
    .map(([fifths, count]) => ({ fifths: Number(fifths), count }))
    .filter((entry) => Number.isInteger(entry.fifths) && Math.abs(entry.fifths) <= MAX_KEY_FIFTHS && entry.count > 0)
  const pool = weighted.length > 0 ? weighted : FALLBACK_KEY_FIFTHS.map((fifths) => ({ fifths, count: 1 }))
  const { fifths } = weightedPick(rng, pool, (entry) => entry.count)
  return { fifths, mode: rng() < 0.5 ? 'major' : 'minor' }
}

/** A round's material, already filtered by the settings, and how its groups are weighted. */
interface ChordMaterialSet {
  material: ChordMaterial
  key: ChordKey | null
  fifths: number
  chords: SpelledChord[]
  groupWeights: Record<string, number>
}

/**
 * What a round may need from the server: the key signature statistic for a
 * random key, and the catalog's chords. Either may be null; a random key then
 * falls back to the common keys, and catalog material with nothing usable to
 * generated chords.
 */
export interface ChordRoundInputs {
  keyCounts: Record<string, number> | null
  catalogChords: CatalogChord[] | null
}

const NO_INPUTS: ChordRoundInputs = { keyCounts: null, catalogChords: null }

/**
 * The material for one round. A catalog round picks its one signature by how
 * many usable chords sit under it, and draws piece first so a handful of
 * chord-heavy pieces do not supply every question.
 */
export function chordMaterial(
  settings: ChordQuizSettings,
  inputs: ChordRoundInputs = NO_INPUTS,
): ChordMaterialSet {
  const rng = createSeededRng(`${settings.seed}:material`)
  if (settings.material === 'catalog') {
    const usable = fromCatalog(inputs.catalogChords ?? []).filter((chord) => askable(chord, settings))
    if (usable.length > 0) {
      const { fifths } = weightedPick(rng, usable, () => 1)
      const chords = usable.filter((chord) => chord.fifths === fifths)
      return { material: 'catalog', key: null, fifths, chords, groupWeights: {} }
    }
  }
  if (settings.keyMode === 'random') {
    const key = drawChordKey(rng, inputs.keyCounts)
    const chords = keyChords(key, settings.accidentalMode).filter((chord) => askable(chord, settings))
    const hasAltered = chords.some((chord) => chord.group === 'altered')
    const groupWeights: Record<string, number> = hasAltered ? { own: DIATONIC_SHARE, altered: 1 - DIATONIC_SHARE } : {}
    return { material: 'generated', key, fifths: key.fifths, chords, groupWeights }
  }
  const chords = keylessChords(settings.accidentalMode).filter((chord) => askable(chord, settings))
  return { material: 'generated', key: null, fifths: 0, chords, groupWeights: {} }
}

/** One chord: a group by its weight (1 when unlisted), then a chord in it by weight. */
function drawChord(rng: () => number, set: ChordMaterialSet): SpelledChord {
  const groups = [...new Set(set.chords.map((chord) => chord.group))]
  const group = weightedPick(rng, groups, (name) => set.groupWeights[name] ?? 1)
  return weightedPick(
    rng,
    set.chords.filter((chord) => chord.group === group),
    (chord) => chord.weight,
  )
}

function drawQuestions(settings: ChordQuizSettings, set: ChordMaterialSet): ChordPlacement[] {
  const rng = createSeededRng(settings.seed)
  const staves = stavesOf(settings.clefMode)
  const placements: ChordPlacement[] = []
  let previousStep: string | null = null
  for (let i = 0; i < settings.questionCount; i += 1) {
    // The staff first, evenly, so the bass clef is not outnumbered.
    const clef = staves[Math.floor(rng() * staves.length)]
    // Never the same root twice running (whatever the inversion): the answer
    // would be free. A one-chord pool repeats rather than ending early.
    let chord = drawChord(rng, set)
    for (let attempt = 0; attempt < 8 && chord.rootStep === previousStep; attempt += 1) {
      chord = drawChord(rng, set)
    }
    previousStep = chord.rootStep
    placements.push(placeChord(clef, chord))
  }
  return placements
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** The steps in canonical order (root, quality, play), never empty. */
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

const ACCIDENTAL_NAMES: Record<number, string> = { [-1]: 'flat', 0: 'natural', 1: 'sharp' }

function noteXml(note: ChordNote, isChordTone: boolean, staff: 1 | 2 | null, fifths: number): string {
  const pitch: Pitch = { midi: note.midi, step: note.step, alter: note.alter || undefined, octave: note.octave, degree: 0 }
  // <chord/> stacks the notes on one stem.
  const chord = isChordTone ? '\n        <chord/>' : ''
  // The printed sign, emitted explicitly: exactly when the note departs from
  // the signature (a natural included).
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

function attributesXml(clefMode: ChordClefMode, fifths: number, mode: ChordKey['mode'] | null): string {
  const modeXml = mode ? `\n          <mode>${mode}</mode>` : ''
  const head = `        <divisions>1</divisions>
        <key>
          <fifths>${fifths}</fifths>${modeXml}
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>`
  if (clefMode === 'both') {
    return `      <attributes>
${head}
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
${head}
        <clef>
          <sign>${isBass ? 'F' : 'G'}</sign>
          <line>${isBass ? 4 : 2}</line>
        </clef>
      </attributes>`
}

function measureXml(question: ChordQuestion, clefMode: ChordClefMode, fifths: number, mode: ChordKey['mode'] | null): string {
  const attributes = question.measureNumber === 1 ? `\n${attributesXml(clefMode, fifths, mode)}\n` : '\n'
  if (clefMode !== 'both') {
    const notes = question.notes.map((note, index) => noteXml(note, index > 0, null, fifths)).join('\n')
    return `    <measure number="${question.measureNumber}">${attributes}${notes}
    </measure>`
  }
  // Grand staff: the chord on its own clef's staff, a whole rest on the other.
  const staff = question.clef === 'treble' ? 1 : 2
  const chord = question.notes.map((note, index) => noteXml(note, index > 0, staff, fifths)).join('\n')
  return `    <measure number="${question.measureNumber}">${attributes}${staff === 1 ? chord : restXml(1)}
      <backup>
        <duration>4</duration>
      </backup>
${staff === 2 ? chord : restXml(2)}
    </measure>`
}

export function generateChordQuizMusicXml(
  questions: ChordQuestion[],
  clefMode: ChordClefMode,
  fifths = 0,
  mode: ChordKey['mode'] | null = null,
): string {
  const measures = questions.map((question) => measureXml(question, clefMode, fifths, mode)).join('\n')
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

export function createChordRound(
  settings: Partial<ChordQuizSettings>,
  inputs: ChordRoundInputs = NO_INPUTS,
): ChordRound {
  const sanitized = sanitize(settings)
  const set = chordMaterial(sanitized, inputs)
  const placements = drawQuestions(sanitized, set)
  const questions: ChordQuestion[] = placements.map((placement, index) => ({
    index,
    measureNumber: index + 1,
    step: placement.rootStep,
    rootAlter: placement.alters[0],
    notes: triadNotes(placement),
    quality: placement.quality,
    degree: placement.numeral,
    inversion: placement.inversion,
    clef: placement.clef,
  }))
  const present = new Set(set.chords.map((chord) => chord.quality))
  return {
    questions,
    file: createMusicXmlFile(
      generateChordQuizMusicXml(questions, sanitized.clefMode, set.fifths, set.key?.mode ?? null),
      'chord-quiz',
    ),
    qualities: QUALITY_ORDER.filter((quality) => present.has(quality)),
    nameOrder: [...STEPS],
    steps: sanitized.answerSteps,
    key: set.key,
    fifths: set.fifths,
    material: set.material,
    sources: placements.map((placement) => placement.source),
  }
}
