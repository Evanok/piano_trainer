/**
 * Pure, DOM-free state machine for one round of the reading quiz, the same
 * shape as `WaitEngine`: it is handed answers and says what happened, and knows
 * nothing about how a note is drawn or how an answer is tapped.
 *
 * It produces the same note-level stats a played session does
 * (`ExerciseSessionStats`), so a quiz can be recorded as an ordinary
 * `PracticeSessionRecord` and the stats screen needs no special case beyond
 * the `reading` source kind.
 */
import type { ExerciseSessionStats } from '../types/session'
import { latinNameOf, pitchLabel } from './readingQuiz'
import type { ReadingQuestion } from './readingQuiz'

export type ReadingAnswerResult = 'correct' | 'wrong' | 'done'

export interface ReadingQuizState {
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

export class ReadingQuizEngine {
  private readonly questions: ReadingQuestion[]
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

  constructor(questions: ReadingQuestion[], now = Date.now()) {
    this.questions = questions
    this.questionShownAt = now
  }

  get state(): ReadingQuizState {
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

  get currentQuestion(): ReadingQuestion | null {
    return this.questions[this.index] ?? null
  }

  /**
   * `step` is a letter name (C..B), not a latin one: the UI translates for
   * display, the engine stays in the app's own vocabulary. The octave is not
   * judged here, since naming a note says nothing about which one was meant.
   *
   * A wrong answer does not advance -- the same note stays on screen until it
   * is named, so the answer is actually learned rather than skipped past.
   */
  answer(step: string, now = Date.now()): ReadingAnswerResult {
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

  /**
   * Answering by tapping a piano key, which does judge the octave: hitting the
   * right name an octave off is a real reading mistake, and the labels keep the
   * octave so the confusion stats can say so.
   */
  answerPitch(midi: number, now = Date.now()): ReadingAnswerResult {
    const question = this.currentQuestion
    if (!question) {
      return 'done'
    }
    return this.judge(midi === question.midi, pitchLabel(question.midi), pitchLabel(midi), now)
  }

  private judge(correct: boolean, expected: string, played: string, now: number): ReadingAnswerResult {
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

  /** Percentage of questions named right on the first attempt. */
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
