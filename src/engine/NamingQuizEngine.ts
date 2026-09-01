/**
 * Pure, DOM-free state machine for one round of any quiz whose questions are
 * answered by naming a note, the same shape as `WaitEngine`: it is handed
 * answers and says what happened, and knows nothing about how a question is
 * drawn or how an answer is tapped.
 *
 * Two drills use it, and they have nothing in common but that: the reading quiz
 * draws a note on a staff, the note-order drill shows a note and a direction.
 * Both ask for a note name, both keep the question on screen until it is right,
 * and both want the same numbers out, so the scoring lives here once. A
 * question only has to carry the `step` that answers it; `ReadingQuizEngine`
 * adds the one thing that is genuinely reading-specific, answering by pressing
 * a piano key, which judges the octave too.
 *
 * It produces the same note-level stats a played session does
 * (`ExerciseSessionStats`), so a round can be recorded as an ordinary
 * `PracticeSessionRecord` and the stats screen needs no special case.
 */
import type { ExerciseSessionStats } from '../types/session'
import { latinNameOf } from './readingQuiz'

export type QuizAnswerResult = 'correct' | 'wrong' | 'done'

export interface QuizState {
  /** Index of the question being asked; equals questions.length once done. */
  index: number
  answeredCount: number
  /** Answered right on the FIRST attempt, which is what accuracy means here. */
  firstTryCount: number
  correctCount: number
  errorCount: number
  combo: number
  maxCombo: number
  completed: boolean
}

/** The least a question has to be: the note name that answers it. */
export interface NamedQuestion {
  step: string
}

export class NamingQuizEngine<Q extends NamedQuestion> {
  protected readonly questions: Q[]
  private index = 0
  private answeredCount = 0
  private firstTryCount = 0
  private correctCount = 0
  private errorCount = 0
  private combo = 0
  private maxCombo = 0
  private missedThisQuestion = false
  private questionShownAt: number | null = null
  private readonly responseTimes: number[] = []
  private readonly missedNotes = new Map<string, number>()
  private readonly wrongNotes = new Map<string, number>()
  private readonly confusions = new Map<string, number>()

  constructor(questions: Q[], now = Date.now()) {
    this.questions = questions
    this.questionShownAt = now
  }

  get state(): QuizState {
    return {
      index: this.index,
      answeredCount: this.answeredCount,
      firstTryCount: this.firstTryCount,
      correctCount: this.correctCount,
      errorCount: this.errorCount,
      combo: this.combo,
      maxCombo: this.maxCombo,
      completed: this.index >= this.questions.length,
    }
  }

  get currentQuestion(): Q | null {
    return this.questions[this.index] ?? null
  }

  /**
   * `step` is a letter name (C..B), not a latin one: the UI translates for
   * display, the engine stays in the app's own vocabulary. The octave is not
   * judged here, since naming a note says nothing about which one was meant.
   *
   * A wrong answer does not advance -- the same question stays on screen until
   * it is answered, so the answer is actually learned rather than skipped past.
   */
  answer(step: string, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question) {
      return 'done'
    }
    return this.judge(
      step.toUpperCase() === question.step,
      latinNameOf(question.step),
      latinNameOf(step),
      now,
    )
  }

  protected judge(correct: boolean, expected: string, played: string, now: number): QuizAnswerResult {
    if (!correct) {
      this.errorCount += 1
      this.combo = 0
      this.missedThisQuestion = true
      this.wrongNotes.set(played, (this.wrongNotes.get(played) ?? 0) + 1)
      this.missedNotes.set(expected, (this.missedNotes.get(expected) ?? 0) + 1)
      const key = `${expected}>${played}`
      this.confusions.set(key, (this.confusions.get(key) ?? 0) + 1)
      return 'wrong'
    }

    this.correctCount += 1
    this.answeredCount += 1
    if (this.missedThisQuestion) {
      this.combo = 0
    } else {
      this.firstTryCount += 1
      this.combo += 1
      this.maxCombo = Math.max(this.maxCombo, this.combo)
      // Only a clean answer times a real reading: a retry measures how long it
      // took to try the remaining names, which is not the same question.
      if (this.questionShownAt !== null) {
        this.responseTimes.push(Math.max(0, now - this.questionShownAt))
      }
    }
    this.index += 1
    this.missedThisQuestion = false
    this.questionShownAt = now
    return this.state.completed ? 'done' : 'correct'
  }

  /** Percentage of questions answered right on the first attempt. */
  get successPercent(): number {
    if (this.answeredCount === 0) {
      return 0
    }
    return Math.round((this.firstTryCount / this.answeredCount) * 100)
  }

  notesStats(): ExerciseSessionStats {
    const sorted = [...this.responseTimes].sort((a, b) => a - b)
    const total = sorted.reduce((sum, value) => sum + value, 0)
    const toList = (map: Map<string, number>) =>
      [...map.entries()]
        .map(([note, count]) => ({ note, count }))
        .sort((a, b) => b.count - a.count || a.note.localeCompare(b.note))
    return {
      responseCount: sorted.length,
      averageResponseMs: sorted.length === 0 ? 0 : Math.round(total / sorted.length),
      medianResponseMs: sorted.length === 0 ? 0 : sorted[Math.floor((sorted.length - 1) / 2)],
      slowestResponseMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
      missedNotes: toList(this.missedNotes),
      wrongNotes: toList(this.wrongNotes),
      confusions: [...this.confusions.entries()]
        .map(([key, count]) => {
          const [expected, played] = key.split('>')
          return { expected, played, count }
        })
        .sort((a, b) => b.count - a.count),
    }
  }
}
