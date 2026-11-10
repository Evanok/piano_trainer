/**
 * The interval drill's engine: the shared scoring (`QuizScoringEngine`) plus a
 * two-step question, the number then the quality, in whichever combination the
 * settings chose. Only the last chosen step finishes the question, which is
 * what `judge`'s `advance` is for -- the same machine as the chord drill's,
 * without its played step.
 *
 * The confusion stats keep each step's own vocabulary, so they read "shown a
 * 3rd, answered 4th" or "shown minor, answered major": which pair is being
 * mixed up is the most useful number the round produces.
 */
import { QuizScoringEngine } from './NamingQuizEngine'
import type { QuizAnswerResult } from './NamingQuizEngine'
import { intervalNumberLabel, intervalQualityLabel } from './intervalQuiz'
import type { IntervalAnswerStep, IntervalQuality, IntervalQuestion } from '../types/interval'

export type { QuizAnswerResult }

export class IntervalQuizEngine extends QuizScoringEngine<IntervalQuestion> {
  private readonly steps: IntervalAnswerStep[]
  private stepIndex = 0

  constructor(questions: IntervalQuestion[], steps: IntervalAnswerStep[], now = Date.now()) {
    super(questions, now)
    this.steps = steps.length > 0 ? steps : ['number']
  }

  /** What the current question is asking for right now, null once the round is over. */
  get currentStep(): IntervalAnswerStep | null {
    return this.currentQuestion ? this.steps[this.stepIndex] : null
  }

  answerNumber(number: number, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question || this.currentStep !== 'number') {
      return 'done'
    }
    return this.submit(
      number === question.number,
      intervalNumberLabel(question.number),
      intervalNumberLabel(number),
      now,
    )
  }

  answerQuality(quality: IntervalQuality, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question || this.currentStep !== 'quality') {
      return 'done'
    }
    return this.submit(
      quality === question.quality,
      intervalQualityLabel(question.quality),
      intervalQualityLabel(quality),
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
