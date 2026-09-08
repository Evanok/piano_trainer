/**
 * The chord-reading drill: draw a triad on a staff, name its quality.
 *
 * Built exactly like the reading quiz, and for the same reason: the whole round
 * is ONE MusicXML score with one chord per measure, loaded once into one OSMD
 * instance, and the quiz screen moves from question to question by cropping to
 * a single measure (`ReadingStaff`). So this generator only has to emit
 * measures, and the engraving is the practice screen's own.
 *
 * Level 1 of the ladder in IDEA.md, and the only one built: the seven diatonic
 * triads of C major, root position, no accidental anywhere. Two facts about
 * that material shape everything here.
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
 * **The root gives the quality away, and that is fine here.** In C major, a
 * chord on re *is* minor -- root and quality are not independent, so this level
 * cannot also ask for the root without asking the same question twice. It is
 * the next rung (accidentals, no key signature) that breaks the correlation and
 * makes the root worth asking for; the field is already on the question.
 */
import { createMusicXmlFile, createSeededRng, xmlEscape } from './musicKeys'
import type { Pitch } from './musicKeys'
import { asMusicXmlPitch } from './musicKeys'
import { diatonicIndex, pitchAtDiatonicIndex, STEPS } from './readingQuiz'
import type {
  ChordClefMode,
  ChordNote,
  ChordQuality,
  ChordQuestion,
  ChordQuizSettings,
} from '../types/chord'

export type { ChordClefMode, ChordNote, ChordQuality, ChordQuestion, ChordQuizSettings }

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
}

export const DEFAULT_CHORD_QUESTION_COUNT = 20

const DEFAULT_SETTINGS: ChordQuizSettings = {
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
 * The lowest root of each clef's octave of roots.
 *
 * A root-position triad occupies five consecutive diatonic positions, so where
 * the roots start decides whether the chords sit on the staff or float off it.
 * These two windows are picked so that all seven triads fit within the staff
 * plus at most ONE ledger line, which is why the bass roots start on G rather
 * than on C: roots C3..B3 would put the top of the si chord (fa4) three
 * positions above the staff, and roots C2..B2 would put the bottom of the do
 * chord two below it.
 *
 * - treble: roots do4..si4, so the lowest note is do4 (one ledger line below)
 *   and the highest is fa5 (the top line).
 * - bass: roots sol2..fa3, so the lowest note is sol2 (the bottom line) and the
 *   highest is do4 (one ledger line above).
 */
const ROOT_BASE: Record<ChordClefMode, number> = {
  treble: diatonicIndex('C', 4),
  bass: diatonicIndex('G', 2),
}

/** The seven roots a round in this clef draws from, lowest first. */
export function chordRoots(clefMode: ChordClefMode): number[] {
  const base = ROOT_BASE[clefMode]
  return Array.from({ length: STEPS.length }, (_, i) => base + i)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function sanitize(settings: Partial<ChordQuizSettings>): ChordQuizSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return { ...merged, questionCount: clamp(Math.round(merged.questionCount), 1, 60) }
}

function noteAt(index: number): ChordNote {
  const pitch = pitchAtDiatonicIndex(index)
  return { midi: pitch.midi, step: pitch.step, octave: pitch.octave }
}

/**
 * The triad on `rootIndex`, spelled out of C major: the root, the note two
 * diatonic steps above it and the note four above. Both are therefore natural
 * notes, and the quality falls out of the key rather than being imposed on it.
 */
export function triadAt(rootIndex: number): ChordNote[] {
  return [noteAt(rootIndex), noteAt(rootIndex + 2), noteAt(rootIndex + 4)]
}

function pickQuestions(settings: ChordQuizSettings): ChordQuestion[] {
  const rng = createSeededRng(settings.seed)
  const roots = chordRoots(settings.clefMode)
  const questions: ChordQuestion[] = []
  let previousRoot = -1
  for (let i = 0; i < settings.questionCount; i += 1) {
    // Never the same chord twice running: the answer would be free, and a
    // repeat reads as the screen having failed to advance.
    let root = previousRoot
    for (let attempt = 0; attempt < 8 && root === previousRoot; attempt += 1) {
      root = roots[Math.floor(rng() * roots.length)]
    }
    previousRoot = root
    const notes = triadAt(root)
    const triad = diatonicTriadOf(notes[0].step)
    questions.push({
      index: i,
      measureNumber: i + 1,
      step: notes[0].step,
      notes,
      quality: triad.quality,
      degree: triad.degree,
    })
  }
  return questions
}

/** Every quality that can come up in this key, in the buttons' own order. */
export function chordQualitiesInPlay(): ChordQuality[] {
  const present = new Set(Object.values(DIATONIC_TRIADS).map((triad) => triad.quality))
  return QUALITY_ORDER.filter((quality) => present.has(quality))
}

function noteXml(note: ChordNote, isChordTone: boolean): string {
  const pitch: Pitch = { midi: note.midi, step: note.step, octave: note.octave, degree: 0 }
  // The second and third notes of a chord carry <chord/>, which is what makes
  // OSMD stack them on one stem instead of drawing three separate whole notes.
  const chord = isChordTone ? '\n        <chord/>' : ''
  return `      <note>${chord}
        ${asMusicXmlPitch(pitch)}
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>
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
  }
}
