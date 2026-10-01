import { describe, expect, it } from 'vitest'
import {
  CHORD_INVERSIONS,
  chordPlacements,
  chordQualitiesInPlay,
  chordQualitySemitones,
  chordRoots,
  chordKeyLabel,
  chordRootButtonLabel,
  createChordRound,
  diatonicTriadOf,
  drawChordKey,
  keyChordPlacements,
  generateChordQuizMusicXml,
  triadAt,
  triadNotes,
} from './chordQuiz'
import { ChordQuizEngine } from './ChordQuizEngine'
import { diatonicIndex } from './readingQuiz'
import { createSeededRng, keySignatureAlter, keySignatureTonic } from './musicKeys'
import { chordSessionTitle } from './sessionLog'
import type { ChordKey, ChordQuizSettings, ChordStaff } from '../types/chord'

type Material = Pick<ChordQuizSettings, 'stackMode' | 'accidentalMode' | 'answerSteps'>

/** Total <duration> per measure: a measure whose durations do not add up does
 * not throw in OSMD, it just renders wrong -- the same trap hanonGenerator's
 * tests cover. A chord's notes share one duration, so a triad of whole notes in
 * 4/4 must sum to 4, not to 12. */
function measureDurations(xml: string): number[] {
  return [...xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)].map((match) => {
    let total = 0
    for (const note of match[1].matchAll(/<note>([\s\S]*?)<\/note>/g)) {
      // A <chord/> note sounds WITH the one before it, so it adds no time.
      if (note[1].includes('<chord/>')) {
        continue
      }
      total += Number(note[1].match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0)
    }
    return total
  })
}

/** The staff's own lines, in diatonic index space, per clef. */
const STAFF_LINES: Record<ChordStaff, { low: number; high: number }> = {
  treble: { low: diatonicIndex('E', 4), high: diatonicIndex('F', 5) },
  bass: { low: diatonicIndex('G', 2), high: diatonicIndex('A', 3) },
}

const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11]
const STEPS_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** The original material: do major's seven, no accidental anywhere. */
const DIATONIC: Material = { stackMode: 'all', accidentalMode: 'none', answerSteps: ['root'] }
/** Everything the generator can draw, which only a round that does not ask for
 * the root by letter can take. */
const EVERYTHING: Material = { stackMode: 'all', accidentalMode: 'all', answerSteps: ['quality'] }

describe('diatonicTriadOf', () => {
  it('names the seven triads of C major, with three majors, three minors and one diminished', () => {
    expect(diatonicTriadOf('C')).toEqual({ quality: 'major', degree: 'I' })
    expect(diatonicTriadOf('D')).toEqual({ quality: 'minor', degree: 'ii' })
    expect(diatonicTriadOf('E')).toEqual({ quality: 'minor', degree: 'iii' })
    expect(diatonicTriadOf('F')).toEqual({ quality: 'major', degree: 'IV' })
    expect(diatonicTriadOf('G')).toEqual({ quality: 'major', degree: 'V' })
    expect(diatonicTriadOf('A')).toEqual({ quality: 'minor', degree: 'vi' })
    expect(diatonicTriadOf('B')).toEqual({ quality: 'diminished', degree: 'vii°' })
  })

  it('offers exactly the three qualities the key contains, so no button is dead', () => {
    const naturalOnly: Material = { stackMode: 'all', accidentalMode: 'none', answerSteps: ['quality'] }
    expect(chordQualitiesInPlay('treble', naturalOnly)).toEqual([
      'major',
      'minor',
      'diminished',
    ])
  })

  it('offers an augmented button whenever the material can draw an augmented chord', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      expect(chordQualitiesInPlay(clefMode, EVERYTHING)).toEqual(['major', 'minor', 'diminished', 'augmented'])
      const drawn = new Set(chordPlacements(clefMode, EVERYTHING).map((entry) => entry.quality))
      expect(new Set(chordQualitiesInPlay(clefMode, EVERYTHING))).toEqual(drawn)
    }
  })
})

describe('triadAt', () => {
  it('spells every triad out of C major, so the stated quality matches the actual semitones', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      for (const root of chordRoots(clefMode)) {
        const notes = triadAt(root)
        const { quality } = diatonicTriadOf(notes[0].step)
        expect([notes[1].midi - notes[0].midi, notes[2].midi - notes[1].midi]).toEqual(
          chordQualitySemitones(quality),
        )
      }
    }
  })

  it('uses natural notes only -- no accidental can appear at this level', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      for (const root of chordRoots(clefMode)) {
        for (const note of triadAt(root)) {
          expect(NATURAL_PITCH_CLASSES).toContain(note.midi % 12)
        }
      }
    }
  })
})

describe('inversions', () => {
  it('places all seven chords in all three positions, in both clefs', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      const placements = chordPlacements(clefMode, DIATONIC)
      expect(placements).toHaveLength(21)
      for (const inversion of CHORD_INVERSIONS) {
        const forInversion = placements.filter((entry) => entry.inversion === inversion)
        expect(new Set(forInversion.map((entry) => entry.stepIndex)).size).toBe(7)
      }
    }
  })

  /**
   * An inverted stack is taller than a root-position one and sits higher above
   * its root, so the octave that keeps do4-mi4-sol4 on the staff does not keep
   * mi4-sol4-do5 on it. Every placement is checked, not just the root ones.
   */
  it('keeps every note of every inversion within one ledger line of the staff', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      const lines = STAFF_LINES[clefMode]
      for (const { root, inversion } of chordPlacements(clefMode, DIATONIC)) {
        for (const note of triadAt(root, inversion)) {
          const index = note.octave * 7 + 'CDEFGAB'.indexOf(note.step)
          expect(index).toBeGreaterThanOrEqual(lines.low - 2)
          expect(index).toBeLessThanOrEqual(lines.high + 2)
        }
      }
    }
  })

  it('is the same three notes whichever way it is stacked', () => {
    for (const { root, inversion } of chordPlacements('treble', DIATONIC)) {
      const stacked = triadAt(root, inversion)
      expect(new Set(stacked.map((note) => note.step))).toEqual(
        new Set(triadAt(root, 0).map((note) => note.step)),
      )
      // Bottom to top, always: that is the order it is drawn in.
      expect(stacked.map((note) => note.midi)).toEqual(
        [...stacked.map((note) => note.midi)].sort((a, b) => a - b),
      )
    }
  })

  /**
   * The rule the whole inverted drill turns on, and the one the lesson teaches:
   * an inversion opens a fourth in the stack, and the note just above that gap
   * is the root. Asserted as a property of every placement rather than trusted.
   */
  it('puts the root immediately above the stack gap', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      for (const { root, inversion } of chordPlacements(clefMode, DIATONIC)) {
        const notes = triadAt(root, inversion)
        const rootStep = triadAt(root, 0)[0].step
        const gaps = [notes[1].midi - notes[0].midi, notes[2].midi - notes[1].midi]
        if (inversion === 0) {
          // No gap: two stacked thirds, and the root is the bottom note.
          expect(gaps.every((gap) => gap <= 4)).toBe(true)
          expect(notes[0].step).toBe(rootStep)
          continue
        }
        const gapIndex = gaps.findIndex((gap) => gap >= 5)
        expect(gapIndex).toBeGreaterThanOrEqual(0)
        expect(notes[gapIndex + 1].step).toBe(rootStep)
      }
    }
  })

  it('draws only root position when asked to, and all three otherwise', () => {
    const rootOnly = createChordRound({ seed: 'rootonly', questionCount: 30, stackMode: 'root' })
    expect(rootOnly.questions.every((q) => q.inversion === 0)).toBe(true)

    const mixed = createChordRound({ seed: 'mixed', questionCount: 60, stackMode: 'all' })
    expect(new Set(mixed.questions.map((q) => q.inversion))).toEqual(new Set([0, 1, 2]))
  })

  it('never asks two inversions of the same chord back to back', () => {
    for (const seed of ['a', 'b', 'c']) {
      const { questions } = createChordRound({ seed, questionCount: 60, stackMode: 'all' })
      for (let i = 1; i < questions.length; i += 1) {
        expect(questions[i].step).not.toBe(questions[i - 1].step)
      }
    }
  })
})

describe('accidentals', () => {
  /**
   * The point of the whole axis: a letter stops deciding its quality. Major and
   * minor -- the two the drill is about -- exist on every natural letter.
   */
  it('offers major and minor on every letter once accidentals are allowed', () => {
    const placements = chordPlacements('treble', EVERYTHING).filter((e) => e.inversion === 0)
    for (let stepIndex = 0; stepIndex < 7; stepIndex += 1) {
      const qualities = new Set(
        placements.filter((e) => e.stepIndex === stepIndex && e.rootAlter === 0).map((e) => e.quality),
      )
      expect(qualities).toContain('major')
      expect(qualities).toContain('minor')
    }
  })

  /**
   * Diminished and augmented have gaps, and the gaps are the readable-spelling
   * rule doing its job rather than a bug: fa diminished would be fa-la flat-do
   * flat, and mi/la/si augmented need a si sharp, a mi sharp or a double sharp.
   * Every one of them is still reachable from an altered root, so no quality is
   * ever missing from the material as a whole.
   */
  it('drops only the chords that cannot be written readably', () => {
    const roots = (quality: string) =>
      new Set(
        chordPlacements('treble', EVERYTHING)
          .filter((e) => e.quality === quality && e.rootAlter === 0)
          .map((e) => STEPS_LETTERS[e.stepIndex]),
      )
    expect(roots('diminished')).toEqual(new Set(['C', 'D', 'E', 'G', 'A', 'B']))
    expect(roots('augmented')).toEqual(new Set(['C', 'D', 'F', 'G']))
    const everyQuality = new Set(chordPlacements('treble', EVERYTHING).map((e) => e.quality))
    expect(everyQuality).toEqual(new Set(['major', 'minor', 'diminished', 'augmented']))
  })

  /**
   * The rule the drill teaches, asserted over every chord the generator can
   * produce: four semitones between the bottom two notes means major, three
   * means minor, and the top interval separates diminished and augmented.
   */
  it('always matches the stated quality to the actual semitones', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      for (const placement of chordPlacements(clefMode, EVERYTHING)) {
        const notes = triadNotes(placement)
        // Rebuild root position from the same spelling, so the check does not
        // depend on which inversion happens to be drawn.
        const stacked = triadNotes({ ...placement, inversion: 0 })
        expect([
          stacked[1].midi - stacked[0].midi,
          stacked[2].midi - stacked[1].midi,
        ]).toEqual(chordQualitySemitones(placement.quality))
        expect(notes.map((n) => n.midi)).toEqual([...notes.map((n) => n.midi)].sort((a, b) => a - b))
      }
    }
  })

  it('never writes a double accidental or an unreadable spelling', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      for (const placement of chordPlacements(clefMode, EVERYTHING)) {
        for (const note of triadNotes(placement)) {
          expect(Math.abs(note.alter)).toBeLessThanOrEqual(1)
          // mi sharp, si sharp, fa flat and do flat are real but unreadable here.
          expect(['E1', 'B1', 'F-1', 'C-1']).not.toContain(`${note.step}${note.alter}`)
        }
      }
    }
  })

  it('keeps do major only when accidentals are off, and names no degree outside it', () => {
    const diatonic = createChordRound({ seed: 'dia', questionCount: 40, accidentalMode: 'none' })
    expect(diatonic.questions.every((q) => q.rootAlter === 0)).toBe(true)
    expect(diatonic.questions.every((q) => q.notes.every((n) => n.alter === 0))).toBe(true)
    expect(diatonic.questions.every((q) => q.degree !== null)).toBe(true)

    const free = createChordRound({
      seed: 'free',
      questionCount: 60,
      accidentalMode: 'all',
      answerSteps: ['quality'],
    })
    expect(free.questions.some((q) => q.notes.some((n) => n.alter !== 0))).toBe(true)
    // A chord outside do major has no degree in it: inventing one would name a
    // key the round is not in.
    expect(free.questions.some((q) => q.degree === null)).toBe(true)
    expect(free.questions.every((q) => (q.degree === null) !== q.notes.every((n) => n.alter === 0))).toBe(
      true,
    )
  })

  it('never puts an accidental on the root while the chord is named by letter', () => {
    const round = createChordRound({
      seed: 'named',
      questionCount: 60,
      accidentalMode: 'all',
      answerSteps: ['root'],
    })
    // The seven name buttons cannot say "fa sharp", so the root stays natural
    // -- the thirds and fifths still move, which is what frees the quality.
    expect(round.questions.every((q) => q.rootAlter === 0)).toBe(true)
    expect(round.questions.some((q) => q.notes.some((n) => n.alter !== 0))).toBe(true)
    expect(new Set(round.questions.map((q) => q.quality)).size).toBeGreaterThan(1)
  })
})

describe('chordRoots', () => {
  it('draws from all seven letters, once each', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      const steps = chordRoots(clefMode).map((root) => triadAt(root)[0].step)
      expect(new Set(steps).size).toBe(7)
    }
  })

  /**
   * The reason the bass roots start on sol rather than on do: every chord has
   * to sit on the staff or within one ledger line of it, or the drill turns
   * into a register-reading exercise on top of a chord-reading one.
   */
  it('keeps every note within one ledger line of the staff', () => {
    for (const clefMode of ['treble', 'bass'] as const) {
      const lines = STAFF_LINES[clefMode]
      for (const root of chordRoots(clefMode)) {
        // One ledger line is two diatonic positions past the outer line.
        expect(root).toBeGreaterThanOrEqual(lines.low - 2)
        expect(root + 4).toBeLessThanOrEqual(lines.high + 2)
      }
    }
  })
})

describe('createChordRound', () => {
  it('is deterministic for a given seed, and rerolls with it', () => {
    const a = createChordRound({ seed: 'abc', questionCount: 12 })
    const b = createChordRound({ seed: 'abc', questionCount: 12 })
    const c = createChordRound({ seed: 'xyz', questionCount: 12 })
    expect(a.questions).toEqual(b.questions)
    expect(c.questions).not.toEqual(a.questions)
  })

  it('emits one measure per question, numbered in order', () => {
    const { questions, file } = createChordRound({ seed: 'x', questionCount: 8 })
    expect(questions).toHaveLength(8)
    expect(questions.map((q) => q.measureNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(file.name.endsWith('.musicxml')).toBe(true)
  })

  it('clamps an absurd question count instead of building it', () => {
    expect(createChordRound({ seed: 's', questionCount: 999 }).questions).toHaveLength(60)
    expect(createChordRound({ seed: 's', questionCount: 0 }).questions).toHaveLength(1)
  })

  it('never asks the same chord twice in a row', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { questions } = createChordRound({ seed, questionCount: 60 })
      for (let i = 1; i < questions.length; i += 1) {
        expect(questions[i].step).not.toBe(questions[i - 1].step)
      }
    }
  })

  it('eventually asks every one of the seven chords', () => {
    const { questions } = createChordRound({ seed: 'coverage', questionCount: 60 })
    expect(new Set(questions.map((q) => q.step)).size).toBe(7)
  })

  it('always draws three stacked notes, the upper two carrying <chord/>', () => {
    const { questions } = createChordRound({ seed: 'xml', questionCount: 10 })
    const xml = generateChordQuizMusicXml(questions, 'treble')
    for (const measure of xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)) {
      expect([...measure[1].matchAll(/<note>/g)]).toHaveLength(3)
      expect([...measure[1].matchAll(/<chord\/>/g)]).toHaveLength(2)
    }
  })

  it('fills each measure exactly once, chord notes sharing the one duration', () => {
    const { questions } = createChordRound({ seed: 'durations', questionCount: 20 })
    for (const clefMode of ['treble', 'bass'] as const) {
      const durations = measureDurations(generateChordQuizMusicXml(questions, clefMode))
      expect(durations).toHaveLength(20)
      expect(durations.every((total) => total === 4)).toBe(true)
    }
  })

  it('states the clef once, on the first measure only', () => {
    const { questions } = createChordRound({ seed: 'clef', questionCount: 5 })
    const treble = generateChordQuizMusicXml(questions, 'treble')
    expect([...treble.matchAll(/<clef>/g)]).toHaveLength(1)
    expect(treble).toContain('<sign>G</sign>')
    expect(generateChordQuizMusicXml(questions, 'bass')).toContain('<sign>F</sign>')
  })

  it('puts each chord of a grand-staff round on its own clef, with a rest on the other', () => {
    const { questions, file } = createChordRound({ seed: 'grand', questionCount: 40, clefMode: 'both' })
    expect(file.name).toContain('chord-quiz')
    const clefs = new Set(questions.map((question) => question.clef))
    expect(clefs).toEqual(new Set(['treble', 'bass']))
    const xml = generateChordQuizMusicXml(questions, 'both')
    expect(xml).toContain('<staves>2</staves>')
    const measures = [...xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)]
    expect(measures).toHaveLength(40)
    measures.forEach((measure, index) => {
      const [upper, lower] = measure[1].split('<backup>')
      const chordHalf = questions[index].clef === 'treble' ? upper : lower
      const restHalf = questions[index].clef === 'treble' ? lower : upper
      expect([...chordHalf.matchAll(/<note>/g)]).toHaveLength(3)
      expect(chordHalf).not.toContain('<rest/>')
      expect(restHalf).toContain('<rest/>')
      // Each half fills the measure on its own: the backup rewinds by a whole note.
      for (const half of [upper, lower]) {
        expect(measureDurations(`<measure number="1">${half}</measure>`)).toEqual([4])
      }
    })
  })

  it('keeps every grand-staff chord inside its own clef\'s window', () => {
    const { questions } = createChordRound({ seed: 'grand-window', questionCount: 60, clefMode: 'both' })
    for (const question of questions) {
      const lines = STAFF_LINES[question.clef]
      for (const note of question.notes) {
        const index = diatonicIndex(note.step, note.octave)
        expect(index).toBeGreaterThanOrEqual(lines.low - 2)
        expect(index).toBeLessThanOrEqual(lines.high + 2)
      }
    }
  })
})

describe('answer modes', () => {
  it('offers the seven names in scale order for naming the chord', () => {
    expect(createChordRound({ seed: 'names' }).nameOrder).toEqual([
      'C',
      'D',
      'E',
      'F',
      'G',
      'A',
      'B',
    ])
  })

  it('judges the chord by its root, which is the inherited answer', () => {
    const round = createChordRound({ seed: 'root', questionCount: 3 })
    const engine = new ChordQuizEngine(round.questions, ['root'])
    const question = round.questions[0]
    const wrongStep = question.step === 'C' ? 'D' : 'C'
    expect(engine.answer(wrongStep)).toBe('wrong')
    expect(engine.currentQuestion).toBe(question)
    expect(engine.answer(question.step)).toBe('correct')
    // Lower case too: the buttons hand over whatever the round carries.
    expect(engine.answer(round.questions[1].step.toLowerCase())).toBe('correct')
  })

  it('names what the round asked for in the session title', () => {
    expect(chordSessionTitle({
        answerSteps: ['root'],
        accidentalMode: 'none',
        stackMode: 'all',
        clefMode: 'treble',
        questionCount: 20,
        seed: 's',
      })).toBe(
      'Chords - name, do major, with inversions, treble clef',
    )
    expect(chordSessionTitle({
        answerSteps: ['quality'],
        accidentalMode: 'all',
        stackMode: 'root',
        clefMode: 'bass',
        questionCount: 20,
        seed: 's',
      })).toBe(
      'Chords - quality, with accidentals, root position, bass clef',
    )
    expect(chordSessionTitle({
        answerSteps: ['root', 'quality', 'play'],
        accidentalMode: 'all',
        stackMode: 'all',
        clefMode: 'treble',
        questionCount: 20,
        seed: 's',
      })).toBe(
      'Chords - name + quality + played, with accidentals, with inversions, treble clef',
    )
  })
})

describe('ChordQuizEngine', () => {
  const round = createChordRound({ seed: 'engine', questionCount: 3 })

  it('advances on the right quality and holds on a wrong one', () => {
    const engine = new ChordQuizEngine(round.questions, ['quality'])
    const first = engine.currentQuestion
    expect(first).not.toBeNull()
    const wrong = first?.quality === 'major' ? 'minor' : 'major'
    expect(engine.answerQuality(wrong)).toBe('wrong')
    // The question stays: a quiz that skips past a miss teaches nothing.
    expect(engine.currentQuestion).toBe(first)
    expect(engine.answerQuality(first?.quality ?? 'major')).toBe('correct')
    expect(engine.currentQuestion).not.toBe(first)
  })

  it('counts first attempts only, and reports the confusion by name', () => {
    const engine = new ChordQuizEngine(round.questions, ['quality'])
    for (const question of round.questions) {
      const wrong = question.quality === 'major' ? 'minor' : 'major'
      engine.answerQuality(wrong)
      engine.answerQuality(question.quality)
    }
    expect(engine.state.completed).toBe(true)
    expect(engine.successPercent).toBe(0)
    const { confusions } = engine.notesStats()
    expect(confusions.length).toBeGreaterThan(0)
    expect(confusions.every((entry) => entry.expected !== entry.played)).toBe(true)
    // Named in words, not as a pitch: "shown a minor, answered major".
    expect(['major', 'minor', 'diminished']).toContain(confusions[0].expected)
  })

  it('reports done on the last right answer', () => {
    const engine = new ChordQuizEngine(round.questions, ['quality'])
    const results = round.questions.map((question) => engine.answerQuality(question.quality))
    expect(results.slice(0, -1).every((result) => result === 'correct')).toBe(true)
    expect(results[results.length - 1]).toBe('done')
    expect(engine.successPercent).toBe(100)
  })
})

describe('key signatures', () => {
  it('derives every signature and its two tonics from the count alone', () => {
    expect(['F', 'C', 'G'].map((step) => keySignatureAlter(3, step))).toEqual([1, 1, 1])
    expect(keySignatureAlter(3, 'D')).toBe(0)
    expect(['B', 'E'].map((step) => keySignatureAlter(-2, step))).toEqual([-1, -1])
    expect(keySignatureAlter(-2, 'A')).toBe(0)
    expect(keySignatureTonic(-2, 'major')).toEqual({ step: 'B', alter: -1 })
    expect(keySignatureTonic(-2, 'minor')).toEqual({ step: 'G', alter: 0 })
    expect(keySignatureTonic(4, 'minor')).toEqual({ step: 'C', alter: 1 })
    expect(keySignatureTonic(-6, 'major')).toEqual({ step: 'G', alter: -1 })
    expect(keySignatureTonic(0, 'minor')).toEqual({ step: 'A', alter: 0 })
  })

  it('names keys and spells the root buttons by the signature', () => {
    expect(chordKeyLabel({ fifths: -2, mode: 'major' })).toBe('si♭ major')
    expect(chordKeyLabel({ fifths: 4, mode: 'minor' })).toBe('do♯ minor')
    expect(chordKeyLabel(null)).toBe('do major')
    expect(chordRootButtonLabel('E', { fifths: -2, mode: 'major' })).toBe('mi♭')
    expect(chordRootButtonLabel('D', { fifths: -2, mode: 'major' })).toBe('re')
    expect(chordRootButtonLabel('E', null)).toBe('mi')
  })

  const OWN_ONLY: Material = { stackMode: 'all', accidentalMode: 'none', answerSteps: ['root'] }
  const WITH_ALTERED: Material = { stackMode: 'all', accidentalMode: 'all', answerSteps: ['quality'] }
  const KEYS: ChordKey[] = []
  for (let fifths = -6; fifths <= 6; fifths += 1) {
    KEYS.push({ fifths, mode: 'major' }, { fifths, mode: 'minor' })
  }

  it("gives every key its own seven chords, spelled by the signature alone", () => {
    for (const key of KEYS) {
      for (const clef of ['treble', 'bass'] as const) {
        const own = keyChordPlacements(clef, key, OWN_ONLY)
        // Seven roots in each of the three positions, one chord each.
        expect(own).toHaveLength(21)
        for (const placement of own) {
          expect(placement.diatonic).toBe(true)
          for (const note of triadNotes(placement)) {
            expect(note.alter).toBe(keySignatureAlter(key.fifths, note.step))
          }
        }
      }
    }
  })

  it("gives the key's own chords the qualities of their degree", () => {
    const byNumeral = (key: ChordKey) =>
      Object.fromEntries(
        keyChordPlacements('treble', key, { ...OWN_ONLY, stackMode: 'root' }).map((entry) => [
          entry.numeral,
          entry.quality,
        ]),
      )
    expect(byNumeral({ fifths: 3, mode: 'major' })).toEqual({
      I: 'major',
      ii: 'minor',
      iii: 'minor',
      IV: 'major',
      V: 'major',
      vi: 'minor',
      'vii°': 'diminished',
    })
    expect(byNumeral({ fifths: -3, mode: 'minor' })).toEqual({
      i: 'minor',
      'ii°': 'diminished',
      III: 'major',
      iv: 'minor',
      v: 'minor',
      VI: 'major',
      VII: 'major',
    })
  })

  it('writes the raised leading note of a minor key in front of the note', () => {
    const key: ChordKey = { fifths: 0, mode: 'minor' }
    const dominant = keyChordPlacements('treble', key, WITH_ALTERED).find(
      (entry) => entry.numeral === 'V' && entry.inversion === 0,
    )
    expect(dominant).toBeDefined()
    expect(triadNotes(dominant!).map((note) => [note.step, note.alter])).toEqual([
      ['E', 0],
      ['G', 1],
      ['B', 0],
    ])
    expect(dominant!.quality).toBe('major')
  })

  it('never draws an altered root in a round that asks for the root', () => {
    for (const key of KEYS) {
      const asked = keyChordPlacements('treble', key, { ...WITH_ALTERED, answerSteps: ['root', 'quality'] })
      expect(asked.every((entry) => entry.rootInKey)).toBe(true)
      expect(asked.some((entry) => !entry.diatonic)).toBe(true)
      // The quality-only round keeps them: vii° of the minor, the borrowed ♭VII.
      // Past four signs they can need a double accidental (fa𝄪 in sol♯ minor),
      // which is left out, so the check stops there.
      if (Math.abs(key.fifths) <= 4) {
        const all = keyChordPlacements('treble', key, WITH_ALTERED)
        expect(all.some((entry) => !entry.rootInKey)).toBe(true)
      }
    }
  })

  it('never needs a double accidental', () => {
    for (const key of KEYS) {
      for (const placement of keyChordPlacements('bass', key, WITH_ALTERED)) {
        expect(placement.alters.every((alter) => Math.abs(alter) <= 1)).toBe(true)
      }
    }
  })

  it('draws signatures as often as the catalog opens in them', () => {
    const rng = createSeededRng('weights')
    const drawn: Record<number, number> = {}
    for (let i = 0; i < 4000; i += 1) {
      const key = drawChordKey(rng, { '0': 3, '-2': 1, '9': 50 })
      drawn[key.fifths] = (drawn[key.fifths] ?? 0) + 1
    }
    // The impossible signature is ignored, the other two keep their 3:1 ratio.
    expect(Object.keys(drawn).sort()).toEqual(['-2', '0'])
    expect(drawn[0] / drawn[-2]).toBeGreaterThan(2.4)
    expect(drawn[0] / drawn[-2]).toBeLessThan(3.6)
  })

  it('falls back to the common keys when the catalog says nothing', () => {
    const rng = createSeededRng('fallback')
    for (let i = 0; i < 200; i += 1) {
      expect(Math.abs(drawChordKey(rng, null).fifths)).toBeLessThanOrEqual(4)
    }
  })

  it('writes the signature, and a sign only where a note departs from it', () => {
    const round = createChordRound(
      { seed: 'key-xml', keyMode: 'random', accidentalMode: 'all', answerSteps: ['quality'], questionCount: 60 },
      { '-3': 1 },
    )
    expect(round.key?.fifths).toBe(-3)
    const xml = generateChordQuizMusicXml(round.questions, 'treble', round.key)
    expect(xml).toContain('<fifths>-3</fifths>')
    const measures = [...xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)]
    measures.forEach((measure, index) => {
      const notes = [...measure[1].matchAll(/<note>([\s\S]*?)<\/note>/g)].map((note) => note[1])
      notes.forEach((note, tone) => {
        const chordNote = round.questions[index].notes[tone]
        const departs = chordNote.alter !== keySignatureAlter(-3, chordNote.step)
        expect(note.includes('<accidental>')).toBe(departs)
      })
    })
    // Roughly a quarter of the chords are altered ones.
    const altered = round.questions.filter((question) =>
      question.notes.some((note) => note.alter !== keySignatureAlter(-3, note.step)),
    ).length
    expect(altered).toBeGreaterThan(5)
    expect(altered).toBeLessThan(30)
    expect(round.questions.every((question) => question.degree !== null)).toBe(true)
  })

  it('keeps the keyless drill exactly as it was', () => {
    const before = createChordRound({ seed: 'unchanged', accidentalMode: 'all', answerSteps: ['quality'] })
    const explicit = createChordRound({
      seed: 'unchanged',
      accidentalMode: 'all',
      answerSteps: ['quality'],
      keyMode: 'none',
    })
    expect(explicit.questions).toEqual(before.questions)
    expect(before.key).toBeNull()
  })

  it('names the key in the session title', () => {
    expect(
      chordSessionTitle(
        { answerSteps: ['root'], accidentalMode: 'all', keyMode: 'random', stackMode: 'all', clefMode: 'both', questionCount: 20, seed: 's' },
        'si♭ major',
      ),
    ).toBe('Chords - name, in si♭ major with altered chords, with inversions, both clefs')
  })
})
