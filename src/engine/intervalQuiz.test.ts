import { describe, expect, it } from 'vitest'
import { IntervalQuizEngine } from './IntervalQuizEngine'
import {
  ALLOWED_QUALITIES,
  createIntervalRound,
  generateIntervalQuizMusicXml,
  intervalCountedLetters,
  intervalName,
  intervalQuality,
} from './intervalQuiz'
import { boundsFor, diatonicIndex } from './readingQuiz'

describe('intervalQuality', () => {
  it('names the natural intervals of do major', () => {
    // do-mi, re-fa, fa-si, si-fa, mi-do, do-si
    expect(intervalQuality(3, 4)).toBe('major')
    expect(intervalQuality(3, 3)).toBe('minor')
    expect(intervalQuality(4, 6)).toBe('augmented')
    expect(intervalQuality(5, 6)).toBe('diminished')
    expect(intervalQuality(6, 8)).toBe('minor')
    expect(intervalQuality(7, 11)).toBe('major')
    expect(intervalQuality(8, 12)).toBe('perfect')
  })

  it('refuses what is not one of the five', () => {
    expect(intervalQuality(5, 9)).toBeNull()
    expect(intervalQuality(3, 1)).toBeNull()
    expect(intervalQuality(1, 0)).toBeNull()
  })
})

describe('createIntervalRound', () => {
  const settingsGrid = [
    { accidentalMode: 'none' as const, clefMode: 'treble' as const },
    { accidentalMode: 'all' as const, clefMode: 'bass' as const },
    { accidentalMode: 'all' as const, clefMode: 'both' as const },
  ]

  it('keeps every question a real, readable interval', () => {
    for (const settings of settingsGrid) {
      for (const seed of ['a', 'b', 'c', 'd']) {
        const round = createIntervalRound({ ...settings, seed, questionCount: 60, layout: 'mixed' })
        for (const question of round.questions) {
          const low = diatonicIndex(question.lower.step, question.lower.octave)
          const high = diatonicIndex(question.upper.step, question.upper.octave)
          // The number is the letters counted inclusively.
          expect(high - low + 1).toBe(question.number)
          expect(question.semitones).toBe(question.upper.midi - question.lower.midi)
          expect(intervalQuality(question.number, question.semitones)).toBe(question.quality)
          expect(ALLOWED_QUALITIES[question.number]).toContain(question.quality)
          // Both notes within one ledger line of the staff, so the crop never clips.
          const window = boundsFor(question.clef, 1)
          expect(low).toBeGreaterThanOrEqual(window.low)
          expect(high).toBeLessThanOrEqual(window.high)
          if (settings.accidentalMode === 'none') {
            expect(question.lower.alter).toBe(0)
            expect(question.upper.alter).toBe(0)
          } else {
            // At most one of the two notes is altered, never a mi♯ or a do♭.
            expect(Math.abs(question.lower.alter) + Math.abs(question.upper.alter)).toBeLessThanOrEqual(1)
            for (const note of [question.lower, question.upper]) {
              expect(['E1', 'B1', 'F-1', 'C-1']).not.toContain(`${note.step}${note.alter}`)
            }
          }
        }
      }
    }
  })

  it('stays within the widest interval chosen', () => {
    const round = createIntervalRound({ seed: 'narrow', questionCount: 60, maxNumber: 5 })
    expect(Math.max(...round.questions.map((question) => question.number))).toBeLessThanOrEqual(5)
    expect(round.numbers).toEqual([2, 3, 4, 5])
  })

  it('actually uses accidentals when asked to', () => {
    const round = createIntervalRound({ seed: 'signs', questionCount: 60, accidentalMode: 'all' })
    const altered = round.questions.filter((question) => question.lower.alter !== 0 || question.upper.alter !== 0)
    expect(altered.length).toBeGreaterThan(10)
  })

  it('is the same round from the same seed', () => {
    const a = createIntervalRound({ seed: 'same', layout: 'mixed', accidentalMode: 'all' })
    const b = createIntervalRound({ seed: 'same', layout: 'mixed', accidentalMode: 'all' })
    expect(a.questions).toEqual(b.questions)
  })

  it('writes one full 4/4 measure per question', () => {
    const round = createIntervalRound({ seed: 'xml', questionCount: 30, layout: 'mixed', clefMode: 'both' })
    const xml = generateIntervalQuizMusicXml(round.questions, 'both')
    const measures = xml.split('<measure ').slice(1)
    expect(measures).toHaveLength(30)
    for (const measure of measures) {
      // Per voice, chord tones excluded: a stacked note shares its duration.
      const byVoice = new Map<string, number>()
      for (const note of measure.split('<note>').slice(1)) {
        if (note.includes('<chord/>')) {
          continue
        }
        const voice = /<voice>(\d)<\/voice>/.exec(note)?.[1] ?? '1'
        const duration = Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1])
        byVoice.set(voice, (byVoice.get(voice) ?? 0) + duration)
      }
      for (const total of byVoice.values()) {
        expect(total).toBe(4)
      }
    }
  })

  it('spells out the counted letters without signs', () => {
    const round = createIntervalRound({ seed: 'letters', questionCount: 40, accidentalMode: 'all' })
    for (const question of round.questions) {
      const letters = intervalCountedLetters(question).split(' ')
      expect(letters).toHaveLength(question.number)
      expect(letters.join('')).not.toMatch(/[♯♭]/)
    }
    expect(intervalName({ number: 3, quality: 'major' })).toBe('major 3rd')
  })
})

describe('IntervalQuizEngine', () => {
  const round = createIntervalRound({ seed: 'engine', questionCount: 3 })

  it('asks the number then the quality, and only the quality moves on', () => {
    const engine = new IntervalQuizEngine(round.questions, ['number', 'quality'])
    const first = round.questions[0]
    expect(engine.currentStep).toBe('number')
    expect(engine.answerNumber(first.number)).toBe('correct')
    expect(engine.currentQuestion).toBe(first)
    expect(engine.currentStep).toBe('quality')
    expect(engine.answerQuality(first.quality)).toBe('correct')
    expect(engine.currentQuestion).toBe(round.questions[1])
    expect(engine.currentStep).toBe('number')
  })

  it('ignores an answer given at the wrong step', () => {
    const engine = new IntervalQuizEngine(round.questions, ['number', 'quality'])
    expect(engine.answerQuality(round.questions[0].quality)).toBe('done')
    expect(engine.state.errorCount).toBe(0)
    expect(engine.currentStep).toBe('number')
  })

  it('costs the first-try credit for a miss at either step, and names the confusion', () => {
    const engine = new IntervalQuizEngine(round.questions, ['number', 'quality'])
    const first = round.questions[0]
    expect(engine.answerNumber(first.number)).toBe('correct')
    const wrongQuality = first.quality === 'major' ? 'minor' : 'major'
    expect(engine.answerQuality(wrongQuality)).toBe('wrong')
    expect(engine.answerQuality(first.quality)).toBe('correct')
    expect(engine.state.firstTryCount).toBe(0)
    expect(engine.state.answeredCount).toBe(1)
    expect(engine.notesStats().confusions[0]).toEqual({ expected: first.quality, played: wrongQuality, count: 1 })
  })

  it('finishes a one-step round on the number alone', () => {
    const engine = new IntervalQuizEngine(round.questions, ['number'])
    for (const question of round.questions) {
      engine.answerNumber(question.number)
    }
    expect(engine.state.completed).toBe(true)
    expect(engine.successPercent).toBe(100)
  })
})
