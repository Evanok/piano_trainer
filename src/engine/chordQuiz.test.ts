import { describe, expect, it } from 'vitest'
import {
  chordQualitiesInPlay,
  chordQualitySemitones,
  chordRoots,
  createChordRound,
  diatonicTriadOf,
  generateChordQuizMusicXml,
  triadAt,
} from './chordQuiz'
import { ChordQuizEngine } from './ChordQuizEngine'
import { diatonicIndex } from './readingQuiz'
import type { ChordClefMode } from '../types/chord'

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
const STAFF_LINES: Record<ChordClefMode, { low: number; high: number }> = {
  treble: { low: diatonicIndex('E', 4), high: diatonicIndex('F', 5) },
  bass: { low: diatonicIndex('G', 2), high: diatonicIndex('A', 3) },
}

const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11]

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
    expect(chordQualitiesInPlay()).toEqual(['major', 'minor', 'diminished'])
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
})

describe('ChordQuizEngine', () => {
  const round = createChordRound({ seed: 'engine', questionCount: 3 })

  it('advances on the right quality and holds on a wrong one', () => {
    const engine = new ChordQuizEngine(round.questions)
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
    const engine = new ChordQuizEngine(round.questions)
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
    const engine = new ChordQuizEngine(round.questions)
    const results = round.questions.map((question) => engine.answerQuality(question.quality))
    expect(results.slice(0, -1).every((result) => result === 'correct')).toBe(true)
    expect(results[results.length - 1]).toBe('done')
    expect(engine.successPercent).toBe(100)
  })
})
