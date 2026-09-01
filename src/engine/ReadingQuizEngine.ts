/**
 * The reading quiz's engine: `NamingQuizEngine` plus the one thing that is
 * genuinely specific to reading a staff, answering by pressing a piano key.
 * Everything else (scoring, combo, response times, confusions) is shared with
 * the note-order drill and lives in the base class.
 */
import { NamingQuizEngine } from './NamingQuizEngine'
import type { QuizAnswerResult, QuizState } from './NamingQuizEngine'
import { pitchLabel } from './readingQuiz'
import type { ReadingQuestion } from './readingQuiz'

export type { QuizAnswerResult, QuizState }

export class ReadingQuizEngine extends NamingQuizEngine<ReadingQuestion> {
  /**
   * Answering by tapping a piano key, which does judge the octave: hitting the
   * right name an octave off is a real reading mistake, and the labels keep the
   * octave so the confusion stats can say so.
   */
  answerPitch(midi: number, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question) {
      return 'done'
    }
    return this.judge(midi === question.midi, pitchLabel(question.midi), pitchLabel(midi), now)
  }
}
