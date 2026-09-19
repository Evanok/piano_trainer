/**
 * The step machine, which is the only thing this engine adds to
 * `NamingQuizEngine`: one question answered in up to three goes, and two
 * deliberate asymmetries about what the played step costs (nothing, and no
 * time).
 */
import { describe, expect, it } from 'vitest'
import { ChordQuizEngine } from './ChordQuizEngine'
import { createChordRound } from './chordQuiz'

const round = createChordRound({ seed: 'steps', questionCount: 3 })

/** The three keys of a question, played together and in a silly order: a chord
 * is judged as a chord, so the order must not matter. */
function playChord(engine: ChordQuizEngine, pitches: number[], at: number) {
  const shuffled = [pitches[1], pitches[2], pitches[0]]
  return shuffled.map((pitch, index) => engine.playNote(pitch, at + index))
}

describe('ChordQuizEngine steps', () => {
  it('asks the steps in order, and only the last one moves to the next chord', () => {
    const engine = new ChordQuizEngine(round.questions, ['root', 'quality'])
    const first = round.questions[0]
    expect(engine.currentStep).toBe('root')

    expect(engine.answer(first.step)).toBe('correct')
    // Same chord, next question about it.
    expect(engine.currentQuestion).toBe(first)
    expect(engine.currentStep).toBe('quality')

    expect(engine.answerQuality(first.quality)).toBe('correct')
    expect(engine.currentQuestion).toBe(round.questions[1])
    expect(engine.currentStep).toBe('root')
  })

  it('refuses an answer given at a step that is not asking for it', () => {
    const engine = new ChordQuizEngine(round.questions, ['root', 'quality'])
    const first = round.questions[0]
    // The quality is not the question yet, so answering it is a no-op rather
    // than a miss: the screen never offers it, and a stale tap must not score.
    expect(engine.answerQuality(first.quality)).toBe('done')
    expect(engine.state.errorCount).toBe(0)
    expect(engine.currentStep).toBe('root')
  })

  it('holds the whole question on a wrong root, and counts it once', () => {
    const engine = new ChordQuizEngine(round.questions, ['root', 'quality'])
    const first = round.questions[0]
    const wrongStep = first.step === 'C' ? 'D' : 'C'

    expect(engine.answer(wrongStep)).toBe('wrong')
    expect(engine.currentStep).toBe('root')
    expect(engine.state.errorCount).toBe(1)
    expect(engine.state.answeredCount).toBe(0)

    engine.answer(first.step)
    engine.answerQuality(first.quality)
    // One question answered, not two, and the miss at the root step costs the
    // first-try credit for all of it.
    expect(engine.state.answeredCount).toBe(1)
    expect(engine.successPercent).toBe(0)
    expect(engine.state.combo).toBe(0)
  })

  it('counts one answered question per chord however many steps it took', () => {
    const engine = new ChordQuizEngine(round.questions, ['root', 'quality'])
    for (const question of round.questions) {
      engine.answer(question.step)
      engine.answerQuality(question.quality)
    }
    expect(engine.state.completed).toBe(true)
    expect(engine.state.answeredCount).toBe(round.questions.length)
    expect(engine.successPercent).toBe(100)
    expect(engine.state.maxCombo).toBe(round.questions.length)
    // Every correct tap is still a correct tap: two per chord.
    expect(engine.state.correctCount).toBe(round.questions.length * 2)
  })

  it('reports done on the last step of the last chord', () => {
    const engine = new ChordQuizEngine(round.questions, ['root', 'quality'])
    const results: string[] = []
    for (const question of round.questions) {
      results.push(engine.answer(question.step))
      results.push(engine.answerQuality(question.quality))
    }
    expect(results[results.length - 1]).toBe('done')
    expect(results.slice(0, -1).every((result) => result === 'correct')).toBe(true)
  })
})

describe('ChordQuizEngine play step', () => {
  it('takes the three keys in any order and then advances', () => {
    const engine = new ChordQuizEngine(round.questions, ['play'])
    const first = round.questions[0]
    const pitches = first.notes.map((note) => note.midi)

    const results = playChord(engine, pitches, 1000)
    expect(results.slice(0, -1).every((result) => result === 'waiting')).toBe(true)
    expect(results[results.length - 1]).toBe('correct')
    expect(engine.currentQuestion).toBe(round.questions[1])
  })

  it('judges the exact octave', () => {
    const engine = new ChordQuizEngine(round.questions, ['play'])
    const first = round.questions[0]
    // The same note an octave off is the same chord and the wrong answer: the
    // step exists to bind a written stack to ONE position under the hands.
    expect(engine.playNote(first.notes[0].midi + 12, 1000)).toBe('wrong')
    expect(engine.currentQuestion).toBe(first)
    expect(engine.playNote(first.notes[0].midi, 1100)).toBe('waiting')
  })

  it('never lets a wrong key cost a stat', () => {
    const engine = new ChordQuizEngine(round.questions, ['root', 'play'])
    const first = round.questions[0]
    engine.answer(first.step, 1000)
    expect(engine.playNote(first.notes[0].midi + 1, 2000)).toBe('wrong')
    // A fat finger is not a misreading: no error, and the chord that WAS read
    // correctly keeps its first-try credit.
    expect(engine.state.errorCount).toBe(0)
    playChord(engine, first.notes.map((note) => note.midi), 3000)
    expect(engine.state.answeredCount).toBe(1)
    expect(engine.successPercent).toBe(100)
  })

  it('leaves the time spent finding the keys out of the reading times', () => {
    const engine = new ChordQuizEngine(round.questions, ['root', 'play'], 0)
    const first = round.questions[0]
    engine.answer(first.step, 1000)
    // Ten seconds hunting for the keys, which is a hand's problem and not a
    // reading one: the question was read in one second.
    playChord(engine, first.notes.map((note) => note.midi), 11000)
    const stats = engine.notesStats()
    expect(stats.responseCount).toBe(1)
    expect(stats.averageResponseMs).toBe(1000)
  })

  it('times nothing at all when the chord is only played', () => {
    const engine = new ChordQuizEngine(round.questions, ['play'], 0)
    playChord(engine, round.questions[0].notes.map((note) => note.midi), 9000)
    // Nothing timed was asked, so no reading time is invented for it.
    expect(engine.notesStats().responseCount).toBe(0)
    expect(engine.state.answeredCount).toBe(1)
  })
})
