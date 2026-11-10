import { describe, expect, it } from 'vitest'
import { RhythmQuizEngine } from './RhythmQuizEngine'
import {
  countSyllable,
  createRhythmRound,
  generateRhythmQuizMusicXml,
  onsetsOf,
  positionLabel,
  RHYTHM_LEVELS,
  RHYTHM_TARGET_COLOR,
} from './rhythmQuiz'

describe('createRhythmRound', () => {
  it('fills every measure exactly and places the target on a note', () => {
    for (const level of RHYTHM_LEVELS) {
      for (const seed of ['a', 'b', 'c', 'd', 'e']) {
        const round = createRhythmRound({ level, seed, questionCount: 60 })
        expect(round.questions).toHaveLength(60)
        for (const question of round.questions) {
          expect(question.durations.reduce((sum, value) => sum + Math.abs(value), 0)).toBe(16)
          expect(question.durations[question.targetIndex]).toBeGreaterThan(0)
          expect(question.onset).toBeGreaterThan(0)
          expect(onsetsOf(question.durations)[question.targetIndex]).toBe(question.onset)
          expect(question.beat).toBe(Math.floor(question.onset / 4) + 1)
          // No two-beat value ever crosses the middle of the measure.
          const onsets = onsetsOf(question.durations)
          question.durations.forEach((value, index) => {
            const start = onsets[index]
            const end = start + Math.abs(value)
            expect(start < 8 && end > 8).toBe(false)
          })
        }
      }
    }
  })

  it('keeps the eighths level on beats and "and"s, and uses every position in the others', () => {
    const eighths = createRhythmRound({ level: 'eighths', seed: 'x', questionCount: 60 })
    expect(eighths.subdivisions).toEqual(['beat', 'and'])
    expect(new Set(eighths.questions.map((question) => question.subdivision))).toEqual(new Set(['beat', 'and']))
    const sixteenths = createRhythmRound({ level: 'sixteenths', seed: 'x', questionCount: 60 })
    expect(new Set(sixteenths.questions.map((question) => question.subdivision))).toEqual(
      new Set(['beat', 'e', 'and', 'a']),
    )
    const syncopated = createRhythmRound({ level: 'syncopated', seed: 'x', questionCount: 60 })
    expect(syncopated.questions.some((question) => question.durations.some((value) => value < 0))).toBe(true)
    expect(eighths.questions.every((question) => question.durations.every((value) => value > 0))).toBe(true)
  })

  it('favours off-beat targets and never asks the same position twice in a row', () => {
    const round = createRhythmRound({ level: 'sixteenths', seed: 'weights', questionCount: 60 })
    const offBeat = round.questions.filter((question) => question.subdivision !== 'beat')
    expect(offBeat.length).toBeGreaterThan(30)
    for (let i = 1; i < round.questions.length; i += 1) {
      expect(round.questions[i].onset).not.toBe(round.questions[i - 1].onset)
    }
  })

  it('colours exactly one note per measure and beams sixteenths on two levels', () => {
    const round = createRhythmRound({ level: 'sixteenths', seed: 'xml', questionCount: 30 })
    const measures = generateRhythmQuizMusicXml(round.questions).split('<measure ').slice(1)
    expect(measures).toHaveLength(30)
    measures.forEach((measure, index) => {
      expect(measure.split(`<notehead color="${RHYTHM_TARGET_COLOR}">`).length - 1).toBe(1)
      const durations = [...measure.matchAll(/<duration>(\d+)<\/duration>/g)].map((match) => Number(match[1]))
      expect(durations.reduce((sum, value) => sum + value, 0)).toBe(16)
      // Every beam opened is closed, on both levels.
      for (const level of ['1', '2']) {
        const begins = measure.split(`<beam number="${level}">begin</beam>`).length - 1
        const ends = measure.split(`<beam number="${level}">end</beam>`).length - 1
        expect(begins, `measure ${index + 1}, level ${level}`).toBe(ends)
      }
    })
    const fourSixteenths = round.questions.findIndex((question) =>
      question.durations.join(',').includes('1,1,1,1'),
    )
    expect(fourSixteenths).toBeGreaterThanOrEqual(0)
    expect(measures[fourSixteenths]).toContain('<beam number="2">continue</beam>')
  })

  it('counts positions the way they are spoken', () => {
    expect([0, 1, 2, 3, 4, 10, 15].map(countSyllable)).toEqual(['1', 'e', '&', 'a', '2', '&', 'a'])
    expect(positionLabel({ beat: 3, subdivision: 'and' })).toBe('3 &')
    expect(positionLabel({ beat: 2, subdivision: 'beat' })).toBe('2')
  })
})

describe('RhythmQuizEngine', () => {
  const round = createRhythmRound({ level: 'sixteenths', seed: 'engine', questionCount: 3 })

  it('asks the beat then the subdivision, and only the second moves on', () => {
    const engine = new RhythmQuizEngine(round.questions, round.steps)
    const first = round.questions[0]
    expect(engine.currentStep).toBe('beat')
    expect(engine.answerBeat(first.beat)).toBe('correct')
    expect(engine.currentQuestion).toBe(first)
    expect(engine.answerSubdivision(first.subdivision)).toBe('correct')
    expect(engine.currentQuestion).toBe(round.questions[1])
    expect(engine.currentStep).toBe('beat')
  })

  it('costs the first-try credit for a missed subdivision and names the confusion', () => {
    const engine = new RhythmQuizEngine(round.questions, round.steps)
    const first = round.questions[0]
    engine.answerBeat(first.beat)
    const wrong = first.subdivision === 'e' ? 'a' : 'e'
    expect(engine.answerSubdivision(wrong)).toBe('wrong')
    expect(engine.answerSubdivision(first.subdivision)).toBe('correct')
    expect(engine.state.firstTryCount).toBe(0)
    expect(engine.notesStats().confusions[0].played).toBe(wrong)
  })

  it('times the next question from the end of the review, not from the answer', () => {
    const engine = new RhythmQuizEngine(round.questions, round.steps, 0)
    const [first, second] = round.questions
    engine.answerBeat(first.beat, 500)
    engine.answerSubdivision(first.subdivision, 1000)
    // Ten seconds spent reading the counted measure, then "Next".
    engine.showNextQuestion(11000)
    engine.answerBeat(second.beat, 11500)
    engine.answerSubdivision(second.subdivision, 12000)
    expect(engine.notesStats().averageResponseMs).toBe(1000)
  })
})
