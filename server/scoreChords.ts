import { readFileSync } from 'node:fs'
import { readScoreXml } from './scoreMetadata.ts'
import { scoreFilePath, type StoredEntry } from './catalogStore.ts'
import type { CatalogChord, ChordInversion, ChordQuality } from '../src/types/chord.ts'

/** A triad as found in one score, before it is joined to the score's entry. */
export type ScoreTriad = Omit<CatalogChord, 'scoreId' | 'title' | 'composer'>

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Semitones from the root to the third and to the fifth, per quality. */
const QUALITY_BY_INTERVALS: Record<string, ChordQuality> = {
  '4,7': 'major',
  '3,7': 'minor',
  '3,6': 'diminished',
  '4,8': 'augmented',
}

interface WrittenNote {
  step: string
  alter: number
  midi: number
}

/**
 * The triad a stack of notes spells, or null when it is not exactly one.
 *
 * It has to reduce to three letters, each a third above the last (a doubled
 * root or fifth is fine, a seventh or a second is not), and to three pitch
 * classes, so a spelling that repeats a letter with two different accidentals
 * (sol and sol♯) is refused rather than guessed at. Judged on the letters, not
 * on the sounds: the drill reads a chord off the staff, so a chord whose
 * spelling is not a stack of thirds is not one it can ask about.
 */
export function triadOf(notes: WrittenNote[]): Omit<ScoreTriad, 'measure' | 'fifths'> | null {
  const letters = [...new Set(notes.map((note) => note.step))]
  const pitchClasses = new Set(notes.map((note) => (((PITCH_CLASS[note.step] + note.alter) % 12) + 12) % 12))
  if (letters.length !== 3 || pitchClasses.size !== 3) {
    return null
  }
  const indices = letters.map((step) => LETTERS.indexOf(step))
  const rootIndex = indices.find((index) => indices.includes((index + 2) % 7) && indices.includes((index + 4) % 7))
  if (rootIndex === undefined) {
    return null
  }
  const toneSteps = [0, 2, 4].map((offset) => LETTERS[(rootIndex + offset) % 7])
  const tones = toneSteps.map((step) => notes.find((note) => note.step === step) as WrittenNote)
  const above = (tone: WrittenNote) =>
    (((PITCH_CLASS[tone.step] + tone.alter - PITCH_CLASS[tones[0].step] - tones[0].alter) % 12) + 12) % 12
  const quality = QUALITY_BY_INTERVALS[`${above(tones[1])},${above(tones[2])}`]
  if (quality === undefined) {
    return null
  }
  const lowest = notes.reduce((low, note) => (note.midi < low.midi ? note : low))
  return {
    rootStep: toneSteps[0],
    alters: [tones[0].alter, tones[1].alter, tones[2].alter],
    quality,
    inversion: toneSteps.indexOf(lowest.step) as ChordInversion,
  }
}

const TOKEN =
  /<part\b[^>]*>|<measure\b[^>]*>|<backup\b|<forward\b|<key\b[^>]*>[\s\S]*?<fifths>\s*(-?\d+)\s*<\/fifths>|<note\b[^>]*>([\s\S]*?)<\/note>/g

/**
 * Every distinct triad written as one stack in a score, with the measure it
 * first appears in and the signature in force there.
 *
 * A stack is what MusicXML writes as a note followed by `<chord/>` notes: one
 * stem, one staff, which is exactly what a reader sees as "a chord". Notes
 * sounding together on two staves are not merged, since nothing on the page
 * draws them as one. Same regex approach as the metadata reader, for the same
 * reason: four flat elements are needed, and Node has no DOM.
 *
 * Deduplicated per score on the chord as drawn (signature, spelling and bottom
 * tone): an accompaniment repeating one chord for a page would otherwise make
 * that piece supply half of every round.
 */
export function extractTriads(xml: string): ScoreTriad[] {
  const found = new Map<string, ScoreTriad>()
  let fifths = 0
  let measure = 0
  let stack: WrittenNote[] = []
  let stackMeasure = 0

  const flush = () => {
    if (stack.length >= 3) {
      const triad = triadOf(stack)
      if (triad) {
        const key = `${fifths}:${triad.rootStep}:${triad.alters.join(',')}:${triad.inversion}`
        if (!found.has(key)) {
          found.set(key, { ...triad, measure: stackMeasure, fifths })
        }
      }
    }
    stack = []
  }

  for (const match of xml.matchAll(TOKEN)) {
    const token = match[0]
    if (match[1] !== undefined) {
      flush()
      fifths = Number(match[1])
      continue
    }
    if (match[2] === undefined) {
      flush()
      if (token.startsWith('<part')) {
        // Every part numbers its own measures and states its own key.
        measure = 0
        fifths = 0
      } else if (token.startsWith('<measure')) {
        measure += 1
      }
      continue
    }
    const body = match[2]
    const isChordTone = /<chord\s*\/>/.test(body)
    if (!isChordTone) {
      flush()
    }
    // Grace and cue notes are ornaments, not part of the harmony as written.
    if (/<rest\b|<grace\b|<cue\s*\/>/.test(body)) {
      continue
    }
    const step = /<step>\s*([A-G])\s*<\/step>/.exec(body)?.[1]
    const octave = Number(/<octave>\s*(-?\d+)\s*<\/octave>/.exec(body)?.[1])
    const alter = Number(/<alter>\s*(-?[\d.]+)\s*<\/alter>/.exec(body)?.[1] ?? 0)
    if (!step || !Number.isInteger(octave) || !Number.isInteger(alter)) {
      // A microtone or an unpitched note: whatever stack it is in is not a triad.
      stack = [{ step: 'X', alter: 0, midi: 0 }, ...stack]
      continue
    }
    if (!isChordTone) {
      stackMeasure = measure
    }
    stack.push({ step, alter, midi: (octave + 1) * 12 + PITCH_CLASS[step] + alter })
  }
  flush()
  return [...found.values()]
}

// Score files are never replaced (an entry can only be edited or deleted), so
// what was found in one never goes stale: cached by id for the process's life.
const triadCache = new Map<string, ScoreTriad[]>()

async function triadsOf(dataDir: string, entry: StoredEntry): Promise<ScoreTriad[]> {
  const cached = triadCache.get(entry.id)
  if (cached) {
    return cached
  }
  let triads: ScoreTriad[] = []
  const file = scoreFilePath(dataDir, entry)
  if (file) {
    try {
      const xml = await readScoreXml(entry.filename, readFileSync(file))
      triads = xml ? extractTriads(xml) : []
    } catch {
      // An unreadable score supplies no chord; it is not worth failing the rest.
    }
  }
  triadCache.set(entry.id, triads)
  return triads
}

/**
 * Every triad in the catalog, joined to its score's current title (titles can
 * be edited, so they are read at request time rather than cached). The first
 * call reads every score file; later ones only the scores added since.
 */
export async function readCatalogChords(dataDir: string, entries: StoredEntry[]): Promise<CatalogChord[]> {
  const chords: CatalogChord[] = []
  for (const entry of entries) {
    for (const triad of await triadsOf(dataDir, entry)) {
      chords.push({ ...triad, scoreId: entry.id, title: entry.title, composer: entry.composer })
    }
  }
  return chords
}
