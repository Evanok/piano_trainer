/**
 * The rhythm drill's engine: the shared scoring (`QuizScoringEngine`) plus a
 * two-step question, the beat then the position inside it. Only the second
 * step finishes the question, which is what `judge`'s `advance` is for -- the
 * interval drill's machine with other vocabulary.
 *
 * The confusions keep each step's own words, so the summary reads "shown beat
 * 3, answered 2" or "shown &, answered e": the second is the one that says
 * whether the subdivision is being counted or guessed.
 */
import { QuizScoringEngine } from './NamingQuizEngine'
import type { QuizAnswerResult } from './NamingQuizEngine'
import { subdivisionLabel } from './rhythmQuiz'
import type { RhythmAnswerStep, RhythmQuestion, RhythmSubdivision } from '../types/rhythm'

export type { QuizAnswerResult }

export class RhythmQuizEngine extends QuizScoringEngine<RhythmQuestion> {
  private readonly steps: RhythmAnswerStep[]
  private stepIndex = 0

  constructor(questions: RhythmQuestion[], steps: RhythmAnswerStep[], now = Date.now()) {
    super(questions, now)
    this.steps = steps.length > 0 ? steps : ['beat', 'subdivision']
  }

  /** What the current question is asking for right now, null once the round is over. */
  get currentStep(): RhythmAnswerStep | null {
    return this.currentQuestion ? this.steps[this.stepIndex] : null
  }

  answerBeat(beat: number, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question || this.currentStep !== 'beat') {
      return 'done'
    }
    return this.submit(beat === question.beat, `beat ${question.beat}`, `beat ${beat}`, now)
  }

  answerSubdivision(subdivision: RhythmSubdivision, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question || this.currentStep !== 'subdivision') {
      return 'done'
    }
    return this.submit(
      subdivision === question.subdivision,
      subdivisionLabel(question.subdivision),
      subdivisionLabel(subdivision),
      now,
    )
  }

  private submit(correct: boolean, expected: string, played: string, now: number): QuizAnswerResult {
    const isLast = this.stepIndex >= this.steps.length - 1
    const result = this.judge(correct, expected, played, now, isLast)
    if (result !== 'wrong') {
      this.stepIndex = isLast ? 0 : this.stepIndex + 1
    }
    return result
  }
}
