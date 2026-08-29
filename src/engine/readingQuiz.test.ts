import { describe, expect, it } from 'vitest'
import { createReadingRound, generateReadingQuizMusicXml, latinNameOf, pitchLabel } from './readingQuiz'
import { ReadingQuizEngine } from './ReadingQuizEngine'

function measureDurations(xml: string): number[][] {
  return [...xml.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)].map((match) => {
    const body = match[1]
    // One entry per voice: a grand-staff measure backs up between them, so the
    // two voices each have to fill the measure on their own.
    const voices = new Map<string, number>()
    for (const note of body.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
      const duration = Number(note[1].match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0)
      const voice = note[1].match(/<voice>(\d+)<\/voice>/)?.[1] ?? '1'
      voices.set(voice, (voices.get(voice) ?? 0) + duration)
    }
    return [...voices.values()]
  })
}

describe('createReadingRound', () => {
  it('is deterministic for a given seed', () => {
    const a = createReadingRound({ seed: 'abc', questionCount: 12 })
    const b = createReadingRound({ seed: 'abc', questionCount: 12 })
    expect(a.questions).toEqual(b.questions)
  })

  it('emits one measure per question, numbered in order', () => {
    const { questions, file } = createReadingRound({ seed: 'x', questionCount: 8 })
    expect(questions).toHaveLength(8)
    expect(questions.map((q) => q.measureNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(file.name.endsWith('.musicxml')).toBe(true)
  })

  it('never repeats the same note twice in a row', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { questions } = createReadingRound({ seed, questionCount: 40, clefMode: 'both' })
      for (let i = 1; i < questions.length; i += 1) {
        expect(questions[i].midi === questions[i - 1].midi).toBe(false)
      }
    }
  })

  it('keeps notes inside the staff at ledger level 0', () => {
    const { questions } = createReadingRound({
      seed: 'level0',
      questionCount: 40,
      ledgerLevel: 0,
      clefMode: 'treble',
    })
    for (const question of questions) {
      // E4 to F5, the treble staff's own five lines.
      expect(question.midi).toBeGreaterThanOrEqual(64)
      expect(question.midi).toBeLessThanOrEqual(77)
    }
  })

  it('reaches middle C under the treble staff at ledger level 1', () => {
    const { questions } = createReadingRound({
      seed: 'ledger',
      questionCount: 200,
      ledgerLevel: 1,
      clefMode: 'treble',
    })
    expect(questions.some((question) => question.midi === 60)).toBe(true)
  })

  it('fills every measure, in every voice, in both layouts', () => {
    for (const clefMode of ['treble', 'bass', 'both'] as const) {
      const { questions } = createReadingRound({ seed: 'xml', questionCount: 10, clefMode })
      const xml = generateReadingQuizMusicXml(questions, clefMode)
      for (const voices of measureDurations(xml)) {
        expect(voices.length).toBe(clefMode === 'both' ? 2 : 1)
        for (const duration of voices) {
          expect(duration).toBe(4)
        }
      }
    }
  })

  it('puts the note on the staff its clef belongs to', () => {
    const { questions } = createReadingRound({ seed: 'staves', questionCount: 20, clefMode: 'both' })
    expect(questions.some((question) => question.clef === 'bass')).toBe(true)
    expect(questions.some((question) => question.clef === 'treble')).toBe(true)
    const xml = generateReadingQuizMusicXml(questions, 'both')
    const measures = [...xml.matchAll(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g)]
    for (const [, number, body] of measures) {
      const question = questions[Number(number) - 1]
      const staffOfNote = body
        .split('<backup>')[question.clef === 'treble' ? 0 : 1]
        .match(/<pitch>/)
      expect(staffOfNote).not.toBeNull()
    }
  })
})

describe('latinNameOf', () => {
  it('translates letter names', () => {
    expect(latinNameOf('C')).toBe('do')
    expect(latinNameOf('B')).toBe('si')
  })
})

describe('ReadingQuizEngine, answering by key', () => {
  const questions = createReadingRound({ seed: 'keys', questionCount: 3 }).questions

  it('judges the octave, unlike naming', () => {
    const engine = new ReadingQuizEngine(questions, 0)
    // The right name an octave off is a real reading mistake here.
    expect(engine.answerPitch(questions[0].midi + 12, 10)).toBe('wrong')
    expect(engine.answerPitch(questions[0].midi, 20)).toBe('correct')
    expect(engine.state.index).toBe(1)
  })

  it('records the confusion with octaves', () => {
    const engine = new ReadingQuizEngine(questions, 0)
    engine.answerPitch(questions[0].midi + 12, 10)
    engine.answerPitch(questions[0].midi, 20)
    const confusion = engine.notesStats().confusions[0]
    expect(confusion.expected).toBe(pitchLabel(questions[0].midi))
    expect(confusion.played).toBe(pitchLabel(questions[0].midi + 12))
    expect(confusion.expected).not.toBe(confusion.played)
  })
})

describe('pitchLabel', () => {
  it('names middle C in latin with its octave', () => {
    expect(pitchLabel(60)).toBe('do4')
    expect(pitchLabel(71)).toBe('si4')
  })
})

describe('ReadingQuizEngine', () => {
  const questions = createReadingRound({ seed: 'engine', questionCount: 3 }).questions

  it('advances on a correct answer and reports done at the end', () => {
    const engine = new ReadingQuizEngine(questions, 0)
    expect(engine.answer(questions[0].step, 100)).toBe('correct')
    expect(engine.answer(questions[1].step, 200)).toBe('correct')
    expect(engine.answer(questions[2].step, 300)).toBe('done')
    expect(engine.state.completed).toBe(true)
    expect(engine.successPercent).toBe(100)
  })

  it('stays on the same question until it is named', () => {
    const engine = new ReadingQuizEngine(questions, 0)
    const wrong = questions[0].step === 'C' ? 'D' : 'C'
    expect(engine.answer(wrong, 50)).toBe('wrong')
    expect(engine.state.index).toBe(0)
    expect(engine.state.errorCount).toBe(1)
    expect(engine.answer(questions[0].step, 90)).toBe('correct')
    expect(engine.state.index).toBe(1)
  })

  it('counts accuracy on the first attempt only, and breaks the combo', () => {
    const engine = new ReadingQuizEngine(questions, 0)
    engine.answer(questions[0].step, 10)
    const wrong = questions[1].step === 'C' ? 'D' : 'C'
    engine.answer(wrong, 20)
    engine.answer(questions[1].step, 30)
    expect(engine.state.combo).toBe(0)
    expect(engine.state.maxCombo).toBe(1)
    expect(engine.successPercent).toBe(50)
  })

  it('records the confusion in latin names, and times clean answers only', () => {
    const engine = new ReadingQuizEngine(questions, 0)
    const wrong = questions[0].step === 'C' ? 'D' : 'C'
    engine.answer(wrong, 500)
    engine.answer(questions[0].step, 900)
    engine.answer(questions[1].step, 1400)
    const stats = engine.notesStats()
    expect(stats.confusions[0]).toEqual({
      expected: latinNameOf(questions[0].step),
      played: latinNameOf(wrong),
      count: 1,
    })
    expect(stats.responseCount).toBe(1)
    expect(stats.averageResponseMs).toBe(500)
  })
})
