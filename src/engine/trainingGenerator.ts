import type {
  CreatedExercise,
  TrainingDifficulty,
  TrainingExerciseContentMode,
  TrainingHandMode,
  TrainingSettings,
} from '../types/training'
import {
  accidentalsLabel,
  asMusicXmlPitch,
  buildChromaticPitches,
  buildScalePitches,
  createMusicXmlFile,
  findKey,
  KEYS,
  RANDOM_KEY,
  xmlEscape,
} from './musicKeys'
import type { KeyConfig, Pitch } from './musicKeys'

export { RANDOM_KEY, TRAINING_KEY_NAMES } from './musicKeys'

type NoteEvent = Pitch[]

interface PhrasePlan {
  melodyDegrees: number[]
  harmonyDegrees: number[]
}

export type CreatedTrainingExercise = CreatedExercise

const BEATS_PER_MEASURE = 4

const DEFAULT_SETTINGS: TrainingSettings = {
  handMode: 'right',
  accidentalMode: 'none',
  difficulty: 'easy',
  contentMode: 'notes',
  tonality: 'major',
  key: RANDOM_KEY,
  measureCount: 8,
  rightOctaveLow: 4,
  rightOctaveHigh: 5,
  leftOctaveLow: 2,
  leftOctaveHigh: 3,
  seed: 'training',
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed)
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function sanitizeSettings(settings: Partial<TrainingSettings>): TrainingSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return {
    ...merged,
    measureCount: clamp(Math.round(merged.measureCount), 4, 32),
    rightOctaveLow: clamp(Math.round(Math.min(merged.rightOctaveLow, merged.rightOctaveHigh)), 1, 7),
    rightOctaveHigh: clamp(Math.round(Math.max(merged.rightOctaveLow, merged.rightOctaveHigh)), 1, 7),
    leftOctaveLow: clamp(Math.round(Math.min(merged.leftOctaveLow, merged.leftOctaveHigh)), 1, 6),
    leftOctaveHigh: clamp(Math.round(Math.max(merged.leftOctaveLow, merged.leftOctaveHigh)), 1, 6),
  }
}

function chooseKey(settings: TrainingSettings, rng: () => number): KeyConfig {
  const keysForTonality = KEYS.filter((key) => key.tonality === settings.tonality)
  // Natural-only exercises use C major or its relative minor, A minor.
  if (settings.accidentalMode === 'none') {
    return KEYS.find((key) => key.name === (settings.tonality === 'minor' ? 'A minor' : 'C major'))!
  }
  if (settings.key !== RANDOM_KEY) {
    // findKey accepts the old full key names as well as the new tonic-only setting.
    const explicit = findKey(settings.key, settings.tonality)
    if (explicit) {
      return explicit
    }
  }
  if (settings.difficulty === 'easy') {
    return pick(keysForTonality.slice(0, 4), rng)
  }
  if (settings.difficulty === 'medium') {
    return pick(keysForTonality.slice(0, 5), rng)
  }
  return pick(keysForTonality, rng)
}

function octaveRangeToMidi(lowOctave: number, highOctave: number): { low: number; high: number } {
  return { low: 12 * (lowOctave + 1), high: 12 * (highOctave + 2) - 1 }
}

function nearestPitchIndex(pitches: Pitch[], targetMidi: number): number {
  let bestIndex = 0
  let bestDistance = Infinity
  pitches.forEach((pitch, index) => {
    const distance = Math.abs(pitch.midi - targetMidi)
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  })
  return bestIndex
}

function nearestStablePitch(pitches: Pitch[], currentMidi: number): Pitch {
  const stable = pitches.filter((pitch) => pitch.degree === 0 || pitch.degree === 2 || pitch.degree === 4)
  return (stable.length > 0 ? stable : pitches).reduce((best, pitch) =>
    Math.abs(pitch.midi - currentMidi) < Math.abs(best.midi - currentMidi) ? pitch : best,
  )
}

function nearestDegreePitchIndex(pitches: Pitch[], degree: number, targetMidi: number): number {
  const matches = pitches
    .map((pitch, index) => ({ pitch, index }))
    .filter(({ pitch }) => pitch.degree === degree)
  const candidates = matches.length > 0 ? matches : pitches.map((pitch, index) => ({ pitch, index }))
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate.pitch.midi - targetMidi) < Math.abs(best.pitch.midi - targetMidi) ? candidate : best,
  ).index
}

function shiftScaleIndexByMidi(pitches: Pitch[], startIndex: number, semitoneShift: number): number {
  return nearestPitchIndex(pitches, pitches[startIndex].midi + semitoneShift)
}

function musicalPhraseTemplates(difficulty: TrainingDifficulty): number[][] {
  if (difficulty === 'easy') {
    return [
      [0, 1, 2, 4, 2, 1, 0, 2],
      [0, 2, 4, 2, 1, 2, 1, 0],
      [2, 1, 0, 1, 2, 4, 2, 0],
    ]
  }
  if (difficulty === 'medium') {
    return [
      [0, 2, 4, 5, 4, 2, 1, 0],
      [2, 4, 5, 4, 2, 1, 0, 2],
      [4, 5, 6, 4, 2, 4, 1, 0],
      [0, 1, 2, 4, 5, 4, 2, 0],
    ]
  }
  return [
    [0, 2, 4, 6, 5, 4, 2, 0],
    [2, 5, 4, 1, 6, 4, 2, 0],
    [4, 2, 6, 5, 3, 4, 1, 0],
    [0, 4, 6, 5, 2, 4, 1, 0],
  ]
}

function cadenceDegrees(phraseIndex: number, totalPhrases: number): number[] {
  if (phraseIndex === totalPhrases - 1) {
    return [2, 1, 0]
  }
  return phraseIndex % 2 === 0 ? [4, 5, 4] : [2, 1, 0]
}

function buildPhrasePlan(beatCount: number, difficulty: TrainingDifficulty, rng: () => number): PhrasePlan {
  const templates = musicalPhraseTemplates(difficulty)
  const phraseLength = BEATS_PER_MEASURE * 2
  const phraseCount = Math.ceil(beatCount / phraseLength)
  const base = pick(templates, rng)
  const melodyDegrees: number[] = []
  const harmonyPattern = [0, 4, 5, 3]

  for (let phrase = 0; phrase < phraseCount; phrase += 1) {
    const cadence = cadenceDegrees(phrase, phraseCount)
    for (let beat = 0; beat < phraseLength; beat += 1) {
      const isCadenceBeat = beat >= phraseLength - cadence.length
      const cadenceIndex = beat - (phraseLength - cadence.length)
      const templateIndex = (beat + (phrase % 2 === 0 ? 0 : 2)) % base.length
      const neighbor = phrase > 0 && beat % 4 === 1 ? (rng() > 0.5 ? 1 : -1) : 0
      const degree = isCadenceBeat ? cadence[cadenceIndex] : base[templateIndex] + neighbor
      melodyDegrees.push(clamp(degree, 0, 6))
    }
  }

  const harmonyDegrees = Array.from({ length: Math.ceil(beatCount / BEATS_PER_MEASURE) }, (_, measure) => {
    if (measure === Math.ceil(beatCount / BEATS_PER_MEASURE) - 1) {
      return 0
    }
    return harmonyPattern[measure % harmonyPattern.length]
  })

  return { melodyDegrees: melodyDegrees.slice(0, beatCount), harmonyDegrees }
}

function generateMelodyLine(
  pitches: Pitch[],
  beatCount: number,
  difficulty: TrainingDifficulty,
  phrasePlan: PhrasePlan,
  allowChromaticPassing: boolean,
  rng: () => number,
): Pitch[] {
  if (pitches.length === 0) {
    throw new Error('The selected octave range does not contain any playable notes.')
  }

  const middleMidi = (pitches[0].midi + pitches[pitches.length - 1].midi) / 2
  const phraseLength = BEATS_PER_MEASURE * 2
  const contourShift = difficulty === 'hard' ? 12 : difficulty === 'medium' ? 7 : 0
  const chromaticPassingChance = difficulty === 'hard' ? 0.3 : difficulty === 'medium' ? 0.22 : 0.12

  return Array.from({ length: beatCount }, (_, beat) => {
    const degree = phrasePlan.melodyDegrees[beat] ?? 0
    const phraseIndex = Math.floor(beat / phraseLength)
    const phraseBeat = beat % phraseLength
    const targetCenter =
      phraseIndex % 2 === 0 || phraseBeat >= phraseLength - 3
        ? middleMidi
        : middleMidi + contourShift * (rng() > 0.5 ? 1 : -1)
    const isCadenceArea = phraseBeat >= phraseLength - 3 || beat === beatCount - 1
    let index = nearestDegreePitchIndex(pitches, degree, targetCenter)

    if (allowChromaticPassing && !isCadenceArea && beat % 2 === 1 && rng() < chromaticPassingChance) {
      index = clamp(index + (rng() > 0.5 ? 1 : -1), 0, pitches.length - 1)
    }

    if (difficulty !== 'easy' && !isCadenceArea && rng() < 0.2) {
      index = shiftScaleIndexByMidi(pitches, index, rng() > 0.5 ? 12 : -12)
    }

    if (beat === beatCount - 1) {
      return nearestStablePitch(pitches, pitches[index].midi)
    }
    return pitches[index]
  })
}

function pitchByDegreeNear(pitches: Pitch[], degree: number, targetMidi: number): Pitch {
  const matches = pitches.filter((pitch) => pitch.degree === degree)
  return (matches.length > 0 ? matches : pitches).reduce((best, pitch) =>
    Math.abs(pitch.midi - targetMidi) < Math.abs(best.midi - targetMidi) ? pitch : best,
  )
}

function chordToneDegrees(rootDegree: number): number[] {
  return [rootDegree, (rootDegree + 2) % 7, (rootDegree + 4) % 7]
}

function accompanimentDegrees(rootDegree: number): number[] {
  return [rootDegree, (rootDegree + 4) % 7, (rootDegree + 2) % 7, (rootDegree + 4) % 7]
}

function melodyEvents(
  pitches: Pitch[],
  beatCount: number,
  difficulty: TrainingDifficulty,
  phrasePlan: PhrasePlan,
  allowChromaticPassing: boolean,
  rng: () => number,
): NoteEvent[] {
  return generateMelodyLine(pitches, beatCount, difficulty, phrasePlan, allowChromaticPassing, rng).map((pitch) => [
    pitch,
  ])
}

function triadNear(pitches: Pitch[], rootDegree: number, centerMidi: number): NoteEvent {
  const tones = chordToneDegrees(rootDegree).map((degree) => pitchByDegreeNear(pitches, degree, centerMidi))
  return Array.from(new Map(tones.map((pitch) => [pitch.midi, pitch])).values()).sort((a, b) => a.midi - b.midi)
}

function triadEvents(pitches: Pitch[], measureCount: number, phrasePlan: PhrasePlan): NoteEvent[] {
  if (pitches.length === 0) {
    throw new Error('The selected octave range does not contain any playable notes.')
  }

  const centerMidi = (pitches[0].midi + pitches[pitches.length - 1].midi) / 2
  const events: NoteEvent[] = []
  for (let measure = 0; measure < measureCount; measure += 1) {
    const rootDegree = phrasePlan.harmonyDegrees[measure] ?? 0
    for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
      events.push(triadNear(pitches, rootDegree, centerMidi))
    }
  }
  return events
}

function mergeMixedEvents(noteEvents: NoteEvent[], chordEvents: NoteEvent[]): NoteEvent[] {
  return noteEvents.map((event, beat) =>
    Math.floor(beat / BEATS_PER_MEASURE) % 2 === 0 ? event : (chordEvents[beat] ?? event),
  )
}

function generateContentEvents(
  pitches: Pitch[],
  beatCount: number,
  measureCount: number,
  settings: TrainingSettings,
  phrasePlan: PhrasePlan,
  allowChromaticPassing: boolean,
  rng: () => number,
): NoteEvent[] {
  if (settings.contentMode === 'triads') {
    return triadEvents(pitches, measureCount, phrasePlan)
  }

  const notes = melodyEvents(pitches, beatCount, settings.difficulty, phrasePlan, allowChromaticPassing, rng)
  if (settings.contentMode === 'mixed') {
    return mergeMixedEvents(notes, triadEvents(pitches, measureCount, phrasePlan))
  }
  return notes
}

function generateLeftAccompaniment(
  pitches: Pitch[],
  measureCount: number,
  phrasePlan: PhrasePlan,
  contentMode: TrainingExerciseContentMode,
): NoteEvent[] {
  if (pitches.length === 0) {
    throw new Error('The selected octave range does not contain any playable notes.')
  }

  const centerMidi = (pitches[0].midi + pitches[pitches.length - 1].midi) / 2
  const notes: NoteEvent[] = []
  const triads: NoteEvent[] = []
  for (let measure = 0; measure < measureCount; measure += 1) {
    const rootDegree = phrasePlan.harmonyDegrees[measure] ?? 0
    for (const degree of accompanimentDegrees(rootDegree)) {
      notes.push([pitchByDegreeNear(pitches, degree, centerMidi)])
      triads.push(triadNear(pitches, rootDegree, centerMidi))
    }
  }
  if (contentMode === 'triads') {
    return triads
  }
  if (contentMode === 'mixed') {
    return mergeMixedEvents(notes, triads)
  }
  return notes
}

function noteXml(pitch: Pitch, staff: 1 | 2, voice: 1 | 2, isChordTone = false): string {
  const chord = isChordTone ? '\n        <chord/>' : ''
  return `      <note>${chord}
        ${asMusicXmlPitch(pitch)}
        <duration>1</duration>
        <voice>${voice}</voice>
        <type>quarter</type>
        <staff>${staff}</staff>
      </note>`
}

function noteEventXml(event: NoteEvent, staff: 1 | 2, voice: 1 | 2): string {
  return event.map((pitch, index) => noteXml(pitch, staff, voice, index > 0)).join('\n')
}

function attributesXml(key: KeyConfig, handMode: TrainingHandMode): string {
  if (handMode === 'both') {
    return `      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>${key.fifths}</fifths>
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

  const isLeft = handMode === 'left'
  return `      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>${key.fifths}</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>${isLeft ? 'F' : 'G'}</sign>
          <line>${isLeft ? 4 : 2}</line>
        </clef>
      </attributes>`
}

function titleFor(settings: TrainingSettings, key: KeyConfig): string {
  const hand =
    settings.handMode === 'both' ? 'Two-hand' : settings.handMode === 'left' ? 'Left-hand' : 'Right-hand'
  return `${hand} training - ${key.name}`
}

function buildMeasureXml(
  measureNumber: number,
  key: KeyConfig,
  handMode: TrainingHandMode,
  rightNotes: NoteEvent[],
  leftNotes: NoteEvent[],
): string {
  const start = (measureNumber - 1) * BEATS_PER_MEASURE
  const attributes = measureNumber === 1 ? `\n${attributesXml(key, handMode)}\n` : '\n'
  if (handMode === 'both') {
    return `    <measure number="${measureNumber}">${attributes}${rightNotes
      .slice(start, start + BEATS_PER_MEASURE)
      .map((event) => noteEventXml(event, 1, 1))
      .join('\n')}
      <backup>
        <duration>4</duration>
      </backup>
${leftNotes
  .slice(start, start + BEATS_PER_MEASURE)
  .map((event) => noteEventXml(event, 2, 2))
  .join('\n')}
    </measure>`
  }

  const notes = handMode === 'left' ? leftNotes : rightNotes
  return `    <measure number="${measureNumber}">${attributes}${notes
    .slice(start, start + BEATS_PER_MEASURE)
    .map((event) => noteEventXml(event, 1, 1))
    .join('\n')}
    </measure>`
}

export function generateTrainingMusicXml(partialSettings: Partial<TrainingSettings> = {}): string {
  const settings = sanitizeSettings(partialSettings)
  const rng = createRng(settings.seed)
  const key = chooseKey(settings, rng)
  const beatCount = settings.measureCount * BEATS_PER_MEASURE
  const phrasePlan = buildPhrasePlan(beatCount, settings.difficulty, rng)

  const rightRange = octaveRangeToMidi(settings.rightOctaveLow, settings.rightOctaveHigh)
  const leftRange = octaveRangeToMidi(settings.leftOctaveLow, settings.leftOctaveHigh)
  const rightScale = buildScalePitches(key, rightRange.low, rightRange.high)
  const leftScale = buildScalePitches(key, leftRange.low, leftRange.high)
  const rightPlayablePitches =
    settings.accidentalMode === 'chromatic' ? buildChromaticPitches(key, rightRange.low, rightRange.high) : rightScale
  const leftPlayablePitches =
    settings.accidentalMode === 'chromatic' ? buildChromaticPitches(key, leftRange.low, leftRange.high) : leftScale
  const rightNotes =
    settings.handMode === 'right'
      ? generateContentEvents(
          rightPlayablePitches,
          beatCount,
          settings.measureCount,
          settings,
          phrasePlan,
          settings.accidentalMode === 'chromatic',
          rng,
        )
      : settings.handMode === 'both'
        ? melodyEvents(
            rightPlayablePitches,
            beatCount,
            settings.difficulty,
            phrasePlan,
            settings.accidentalMode === 'chromatic',
            rng,
          )
        : []
  const leftNotes =
    settings.handMode === 'both'
      ? generateLeftAccompaniment(leftScale, settings.measureCount, phrasePlan, settings.contentMode)
      : settings.handMode === 'left'
        ? generateContentEvents(
            leftPlayablePitches,
            beatCount,
            settings.measureCount,
            settings,
            phrasePlan,
            settings.accidentalMode === 'chromatic',
            rng,
          )
        : []

  const measures = Array.from({ length: settings.measureCount }, (_, i) =>
    buildMeasureXml(i + 1, key, settings.handMode, rightNotes, leftNotes),
  ).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>${xmlEscape(titleFor(settings, key))}</work-title>
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

export function createTrainingExercise(settings: Partial<TrainingSettings>): CreatedTrainingExercise {
  const sanitized = sanitizeSettings(settings)
  const key = chooseKey(sanitized, createRng(sanitized.seed))
  return {
    file: createMusicXmlFile(generateTrainingMusicXml(sanitized), 'training-exercise'),
    keyName: key.name,
    tonicPitchClass: key.scale[0].pc,
    accidentalsLabel: accidentalsLabel(key),
  }
}

export function createTrainingExerciseFile(settings: Partial<TrainingSettings>): File {
  return createTrainingExercise(settings).file
}
