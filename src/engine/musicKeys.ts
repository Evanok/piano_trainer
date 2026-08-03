/**
 * Key signatures, diatonic pitch spelling, and the small MusicXML primitives
 * shared by every in-memory exercise generator (`trainingGenerator`,
 * `hanonGenerator`). Kept separate so there is one key table rather than one
 * per generator.
 */

export interface KeyConfig {
  name: string
  tonic: string
  tonality: 'major' | 'minor'
  fifths: number
  scale: Array<{ pc: number; step: string; alter?: number; degree: number }>
}

export interface Pitch {
  midi: number
  step: string
  alter?: number
  octave: number
  degree: number
}

export const SHARP_ORDER = ['F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯']
export const FLAT_ORDER = ['B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭', 'F♭']

export const KEYS: KeyConfig[] = [
  {
    name: 'C major',
    tonic: 'C',
    tonality: 'major',
    fifths: 0,
    scale: [
      { pc: 0, step: 'C', degree: 0 },
      { pc: 2, step: 'D', degree: 1 },
      { pc: 4, step: 'E', degree: 2 },
      { pc: 5, step: 'F', degree: 3 },
      { pc: 7, step: 'G', degree: 4 },
      { pc: 9, step: 'A', degree: 5 },
      { pc: 11, step: 'B', degree: 6 },
    ],
  },
  {
    name: 'G major',
    tonic: 'G',
    tonality: 'major',
    fifths: 1,
    scale: [
      { pc: 7, step: 'G', degree: 0 },
      { pc: 9, step: 'A', degree: 1 },
      { pc: 11, step: 'B', degree: 2 },
      { pc: 0, step: 'C', degree: 3 },
      { pc: 2, step: 'D', degree: 4 },
      { pc: 4, step: 'E', degree: 5 },
      { pc: 6, step: 'F', alter: 1, degree: 6 },
    ],
  },
  {
    name: 'D major',
    tonic: 'D',
    tonality: 'major',
    fifths: 2,
    scale: [
      { pc: 2, step: 'D', degree: 0 },
      { pc: 4, step: 'E', degree: 1 },
      { pc: 6, step: 'F', alter: 1, degree: 2 },
      { pc: 7, step: 'G', degree: 3 },
      { pc: 9, step: 'A', degree: 4 },
      { pc: 11, step: 'B', degree: 5 },
      { pc: 1, step: 'C', alter: 1, degree: 6 },
    ],
  },
  {
    name: 'F major',
    tonic: 'F',
    tonality: 'major',
    fifths: -1,
    scale: [
      { pc: 5, step: 'F', degree: 0 },
      { pc: 7, step: 'G', degree: 1 },
      { pc: 9, step: 'A', degree: 2 },
      { pc: 10, step: 'B', alter: -1, degree: 3 },
      { pc: 0, step: 'C', degree: 4 },
      { pc: 2, step: 'D', degree: 5 },
      { pc: 4, step: 'E', degree: 6 },
    ],
  },
  {
    name: 'B-flat major',
    tonic: 'B-flat',
    tonality: 'major',
    fifths: -2,
    scale: [
      { pc: 10, step: 'B', alter: -1, degree: 0 },
      { pc: 0, step: 'C', degree: 1 },
      { pc: 2, step: 'D', degree: 2 },
      { pc: 3, step: 'E', alter: -1, degree: 3 },
      { pc: 5, step: 'F', degree: 4 },
      { pc: 7, step: 'G', degree: 5 },
      { pc: 9, step: 'A', degree: 6 },
    ],
  },
  {
    name: 'A major',
    tonic: 'A',
    tonality: 'major',
    fifths: 3,
    scale: [
      { pc: 9, step: 'A', degree: 0 },
      { pc: 11, step: 'B', degree: 1 },
      { pc: 1, step: 'C', alter: 1, degree: 2 },
      { pc: 2, step: 'D', degree: 3 },
      { pc: 4, step: 'E', degree: 4 },
      { pc: 6, step: 'F', alter: 1, degree: 5 },
      { pc: 8, step: 'G', alter: 1, degree: 6 },
    ],
  },
  {
    name: 'E-flat major',
    tonic: 'E-flat',
    tonality: 'major',
    fifths: -3,
    scale: [
      { pc: 3, step: 'E', alter: -1, degree: 0 },
      { pc: 5, step: 'F', degree: 1 },
      { pc: 7, step: 'G', degree: 2 },
      { pc: 8, step: 'A', alter: -1, degree: 3 },
      { pc: 10, step: 'B', alter: -1, degree: 4 },
      { pc: 0, step: 'C', degree: 5 },
      { pc: 2, step: 'D', degree: 6 },
    ],
  },
  {
    name: 'C minor', tonic: 'C', tonality: 'minor', fifths: -3,
    scale: [
      { pc: 0, step: 'C', degree: 0 }, { pc: 2, step: 'D', degree: 1 },
      { pc: 3, step: 'E', alter: -1, degree: 2 }, { pc: 5, step: 'F', degree: 3 },
      { pc: 7, step: 'G', degree: 4 }, { pc: 8, step: 'A', alter: -1, degree: 5 },
      { pc: 10, step: 'B', alter: -1, degree: 6 },
    ],
  },
  {
    name: 'G minor', tonic: 'G', tonality: 'minor', fifths: -2,
    scale: [
      { pc: 7, step: 'G', degree: 0 }, { pc: 9, step: 'A', degree: 1 },
      { pc: 10, step: 'B', alter: -1, degree: 2 }, { pc: 0, step: 'C', degree: 3 },
      { pc: 2, step: 'D', degree: 4 }, { pc: 3, step: 'E', alter: -1, degree: 5 },
      { pc: 5, step: 'F', degree: 6 },
    ],
  },
  {
    name: 'D minor', tonic: 'D', tonality: 'minor', fifths: -1,
    scale: [
      { pc: 2, step: 'D', degree: 0 }, { pc: 4, step: 'E', degree: 1 },
      { pc: 5, step: 'F', degree: 2 }, { pc: 7, step: 'G', degree: 3 },
      { pc: 9, step: 'A', degree: 4 }, { pc: 10, step: 'B', alter: -1, degree: 5 },
      { pc: 0, step: 'C', degree: 6 },
    ],
  },
  {
    name: 'F minor', tonic: 'F', tonality: 'minor', fifths: -4,
    scale: [
      { pc: 5, step: 'F', degree: 0 }, { pc: 7, step: 'G', degree: 1 },
      { pc: 8, step: 'A', alter: -1, degree: 2 }, { pc: 10, step: 'B', alter: -1, degree: 3 },
      { pc: 0, step: 'C', degree: 4 }, { pc: 1, step: 'D', alter: -1, degree: 5 },
      { pc: 3, step: 'E', alter: -1, degree: 6 },
    ],
  },
  {
    name: 'B-flat minor', tonic: 'B-flat', tonality: 'minor', fifths: -5,
    scale: [
      { pc: 10, step: 'B', alter: -1, degree: 0 }, { pc: 0, step: 'C', degree: 1 },
      { pc: 1, step: 'D', alter: -1, degree: 2 }, { pc: 3, step: 'E', alter: -1, degree: 3 },
      { pc: 5, step: 'F', degree: 4 }, { pc: 6, step: 'G', alter: -1, degree: 5 },
      { pc: 8, step: 'A', alter: -1, degree: 6 },
    ],
  },
  {
    name: 'A minor', tonic: 'A', tonality: 'minor', fifths: 0,
    scale: [
      { pc: 9, step: 'A', degree: 0 }, { pc: 11, step: 'B', degree: 1 },
      { pc: 0, step: 'C', degree: 2 }, { pc: 2, step: 'D', degree: 3 },
      { pc: 4, step: 'E', degree: 4 }, { pc: 5, step: 'F', degree: 5 },
      { pc: 7, step: 'G', degree: 6 },
    ],
  },
  {
    name: 'E-flat minor', tonic: 'E-flat', tonality: 'minor', fifths: -6,
    scale: [
      { pc: 3, step: 'E', alter: -1, degree: 0 }, { pc: 5, step: 'F', degree: 1 },
      { pc: 6, step: 'G', alter: -1, degree: 2 }, { pc: 8, step: 'A', alter: -1, degree: 3 },
      { pc: 10, step: 'B', alter: -1, degree: 4 }, { pc: 11, step: 'C', alter: -1, degree: 5 },
      { pc: 1, step: 'D', alter: -1, degree: 6 },
    ],
  },
]

const CHROMATIC_SHARP = [
  { step: 'C' },
  { step: 'C', alter: 1 },
  { step: 'D' },
  { step: 'D', alter: 1 },
  { step: 'E' },
  { step: 'F' },
  { step: 'F', alter: 1 },
  { step: 'G' },
  { step: 'G', alter: 1 },
  { step: 'A' },
  { step: 'A', alter: 1 },
  { step: 'B' },
]

const CHROMATIC_FLAT = [
  { step: 'C' },
  { step: 'D', alter: -1 },
  { step: 'D' },
  { step: 'E', alter: -1 },
  { step: 'E' },
  { step: 'F' },
  { step: 'G', alter: -1 },
  { step: 'G' },
  { step: 'A', alter: -1 },
  { step: 'A' },
  { step: 'B', alter: -1 },
  { step: 'B' },
]

export const RANDOM_KEY = 'random'
export const TRAINING_KEY_NAMES = Array.from(new Set(KEYS.map((key) => key.tonic)))

export function findKey(tonic: string, tonality: 'major' | 'minor'): KeyConfig | undefined {
  return KEYS.find((key) => key.tonality === tonality && (key.tonic === tonic || key.name === tonic))
}

export function xmlOctave(midi: number): number {
  return Math.floor(midi / 12) - 1
}

export function buildScalePitches(key: KeyConfig, lowMidi: number, highMidi: number): Pitch[] {
  const byPc = new Map(key.scale.map((pitch) => [pitch.pc, pitch]))
  const pitches: Pitch[] = []
  for (let midi = lowMidi; midi <= highMidi; midi += 1) {
    const scalePitch = byPc.get(((midi % 12) + 12) % 12)
    if (scalePitch) {
      pitches.push({ ...scalePitch, midi, octave: xmlOctave(midi) })
    }
  }
  return pitches
}

export function buildChromaticPitches(key: KeyConfig, lowMidi: number, highMidi: number): Pitch[] {
  const table = key.fifths < 0 ? CHROMATIC_FLAT : CHROMATIC_SHARP
  const degreeByPc = new Map(key.scale.map((pitch) => [pitch.pc, pitch.degree]))
  const pitches: Pitch[] = []
  for (let midi = lowMidi; midi <= highMidi; midi += 1) {
    const pc = ((midi % 12) + 12) % 12
    pitches.push({ ...table[pc], midi, octave: xmlOctave(midi), degree: degreeByPc.get(pc) ?? -1 })
  }
  return pitches
}

export function accidentalsLabel(key: KeyConfig): string {
  if (key.fifths === 0) {
    return 'No sharps or flats'
  }
  const notes = (key.fifths > 0 ? SHARP_ORDER : FLAT_ORDER).slice(0, Math.abs(key.fifths))
  return `${key.fifths > 0 ? 'Sharps' : 'Flats'}: ${notes.join(', ')}`
}

export function asMusicXmlPitch(pitch: Pitch): string {
  const alter = pitch.alter ? `\n          <alter>${pitch.alter}</alter>` : ''
  return `<pitch>
          <step>${pitch.step}</step>${alter}
          <octave>${pitch.octave}</octave>
        </pitch>`
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The extension matters downstream: OSMD decides whether to unzip or parse XML
 * from the File's own name, so a generated exercise has to look like a picked
 * `.musicxml` file.
 */
export function createMusicXmlFile(xml: string, baseName: string): File {
  const dateStamp = new Date().toISOString().slice(0, 10)
  return new File([xml], `${baseName}-${dateStamp}.musicxml`, {
    type: 'application/vnd.recordare.musicxml+xml',
  })
}
