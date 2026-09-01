import { describe, expect, it } from 'vitest'
import { createNoteSequenceRound, stepAway } from './noteSequence'
import { isCountableOrder } from './readingQuiz'
import { NamingQuizEngine } from './NamingQuizEngine'

describe('stepAway', () => {
  it('walks the ring in both directions', () => {
    expect(stepAway('C', 'up', 1)).toBe('D')
    expect(stepAway('C', 'down', 1)).toBe('B')
    expect(stepAway('C', 'up', 2)).toBe('E')
    expect(stepAway('D', 'down', 2)).toBe('B')
    expect(stepAway('B', 'up', 2)).toBe('D')
  })
})

describe('createNoteSequenceRound', () => {
  it('is deterministic for a given seed, and rerolls for another', () => {
    const first = createNoteSequenceRound({ seed: 'a' })
    expect(createNoteSequenceRound({ seed: 'a' }).questions).toEqual(first.questions)
    expect(createNoteSequenceRound({ seed: 'b' }).questions).not.toEqual(first.questions)
  })

  it('jumps: a question is unrelated to the one before it', () => {
    // A chained round (each question starting on the last answer) was tried
    // first and made half of every question free.
    const { questions } = createNoteSequenceRound({ seed: 'jump', questionCount: 40 })
    const chained = questions.filter((q, i) => i > 0 && q.from === questions[i - 1].step)
    expect(chained.length).toBeLessThan(questions.length / 3)
  })

  it('never asks about the same note twice running', () => {
    const { questions } = createNoteSequenceRound({ seed: 'repeat', questionCount: 60 })
    for (let i = 1; i < questions.length; i += 1) {
      expect(questions[i].from).not.toBe(questions[i - 1].from)
    }
  })

  it('covers the whole ring over a round, rather than a neighbourhood', () => {
    const { questions } = createNoteSequenceRound({ seed: 'spread', questionCount: 40 })
    expect(new Set(questions.map((q) => q.from)).size).toBe(7)
  })

  it('answers each question with the note its own direction and distance name', () => {
    for (const question of createNoteSequenceRound({ seed: 'x', direction: 'mixed', distance: 'mixed' }).questions) {
      expect(question.step).toBe(stepAway(question.from, question.direction, question.distance))
    }
  })

  it('actually asks both directions when asked to', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const { questions } = createNoteSequenceRound({ seed, direction: 'mixed', questionCount: 40 })
      const up = questions.filter((q) => q.direction === 'up').length
      expect(up).toBeGreaterThan(5)
      expect(questions.length - up).toBeGreaterThan(5)
    }
  })

  it('asks downwards by default, the one direction nobody has by heart', () => {
    const { questions } = createNoteSequenceRound({ seed: 'default' })
    expect(questions.every((q) => q.direction === 'down')).toBe(true)
  })

  it('honours a fixed direction and a fixed distance', () => {
    const down = createNoteSequenceRound({ seed: 'd', direction: 'down', distance: 'third' })
    expect(down.questions.every((q) => q.direction === 'down')).toBe(true)
    expect(down.questions.every((q) => q.distance === 2)).toBe(true)
  })

  it('always shuffles the buttons, since the scale order would answer for the player', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      expect(isCountableOrder(createNoteSequenceRound({ seed }).nameOrder)).toBe(false)
    }
  })

  it('clamps the question count', () => {
    expect(createNoteSequenceRound({ seed: 'a', questionCount: 0 }).questions).toHaveLength(1)
    expect(createNoteSequenceRound({ seed: 'a', questionCount: 999 }).questions).toHaveLength(60)
  })
})

describe('the shared engine, on a sequence round', () => {
  it('scores a round the same way it scores a reading round', () => {
    const { questions } = createNoteSequenceRound({ seed: 'engine', questionCount: 3 })
    const engine = new NamingQuizEngine(questions, 0)

    // A wrong answer keeps the same question up, and breaks the combo.
    const wrongStep = stepAway(questions[0].step, 'up', 1)
    expect(engine.answer(wrongStep, 10)).toBe('wrong')
    expect(engine.currentQuestion).toBe(questions[0])
    expect(engine.answer(questions[0].step, 20)).toBe('correct')
    expect(engine.state.combo).toBe(0)

    expect(engine.answer(questions[1].step, 30)).toBe('correct')
    expect(engine.answer(questions[2].step, 40)).toBe('done')
    expect(engine.state.completed).toBe(true)
    // Two of three named on the first try.
    expect(engine.successPercent).toBe(67)
    expect(engine.notesStats().confusions).toHaveLength(1)
  })
})
