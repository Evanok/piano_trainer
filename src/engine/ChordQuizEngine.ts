/**
 * The chord drill's engine: `NamingQuizEngine` plus the one thing that is
 * specific to it, answering with a chord quality instead of a note name.
 *
 * Everything that makes a round a round -- combo, first-try accuracy, response
 * times, confusions, holding the question until it is answered -- is the shared
 * engine's, exactly as for the reading quiz and the note-order drill. Only the
 * vocabulary of an answer differs, so only that is here.
 *
 * The inherited `answer(step)` still asks for the ROOT's letter name, which is
 * the next rung of the ladder (see chordQuiz.ts) and is deliberately left
 * reachable rather than sealed off; nothing calls it yet.
 */
import { NamingQuizEngine } from './NamingQuizEngine'
import type { QuizAnswerResult } from './NamingQuizEngine'
import { chordQualityLabel } from './chordQuiz'
import type { ChordQuality, ChordQuestion } from '../types/chord'

export type { QuizAnswerResult }

export class ChordQuizEngine extends NamingQuizEngine<ChordQuestion> {
  /**
   * Judge a quality. The confusion stats therefore read "shown a minor,
   * answered diminished", which is the most useful number this drill produces:
   * which pair of chords is actually being mixed up.
   */
  answerQuality(quality: ChordQuality, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question) {
      return 'done'
    }
    return this.judge(
      quality === question.quality,
      chordQualityLabel(question.quality),
      chordQualityLabel(quality),
      now,
    )
  }
}
