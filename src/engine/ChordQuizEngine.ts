/**
 * The chord drill's engine: `NamingQuizEngine` plus the one thing that is
 * specific to it -- a question that takes several answers in a row.
 *
 * Everything that makes a round a round (combo, first-try accuracy, response
 * times, confusions, holding the question until it is answered) is the shared
 * engine's, exactly as for the reading quiz and the note-order drill. What is
 * here is the step machine: a question asks for the root, then the quality,
 * then the chord played on a real keyboard, in that order and in whichever
 * combination the settings chose (`ChordAnswerStep`). Only the last of the
 * chosen steps finishes the question, which is what `judge`'s `advance` is for.
 *
 * Two deliberate asymmetries in what the steps cost:
 *
 * - **The `play` step is never judged into the stats.** Once the chord has been
 *   named its keys are determined, so there is no knowledge left to test, only
 *   the physical mapping: it is practice, not assessment. A wrong key therefore
 *   does not advance and is shown in red, but it does not count as an error and
 *   cannot cost the first-try credit for a chord that WAS read correctly. A fat
 *   finger is not a misreading.
 * - **The `play` step is not timed either**, so the seconds spent hunting for
 *   keys never land in the round's reading times. The clock stops as the step
 *   is entered (`stopResponseClock`), not when the question finally advances.
 *
 * The chord itself is judged by a `WaitEngine` holding a single expected event,
 * which is the same code the practice screen plays real scores with: notes in
 * any order, held together within the chord tolerance, a wrong note clearing
 * the attempt. The octave is judged too -- these are exact pitches, and the
 * whole point of the step is to bind a written stack to one position under the
 * hands.
 */
import { NamingQuizEngine } from './NamingQuizEngine'
import type { QuizAnswerResult } from './NamingQuizEngine'
import { WaitEngine } from './WaitEngine'
import { chordName, chordQualityLabel } from './chordQuiz'
import { latinNameOf } from './readingQuiz'
import type { ChordAnswerStep, ChordQuality, ChordQuestion } from '../types/chord'

export type { QuizAnswerResult }

/**
 * What a played note did. `waiting` means the chord is not complete yet, which
 * has no equivalent among the tapped answers: the other three are the shared
 * engine's own results.
 */
export type ChordPlayResult = QuizAnswerResult | 'waiting'

export class ChordQuizEngine extends NamingQuizEngine<ChordQuestion> {
  private readonly steps: ChordAnswerStep[]
  private stepIndex = 0
  /** The current chord as one expected event, while the play step is running. */
  private play: WaitEngine | null = null

  constructor(questions: ChordQuestion[], steps: ChordAnswerStep[], now = Date.now()) {
    super(questions, now)
    this.steps = steps.length > 0 ? steps : ['root']
    this.enterStep(null)
  }

  /** What the current question is asking for right now, null once the round is over. */
  get currentStep(): ChordAnswerStep | null {
    return this.currentQuestion ? this.steps[this.stepIndex] : null
  }

  /** The keys held so far in the play step, for the on-screen keyboard. */
  get heldPlayPitches(): number[] {
    return this.play?.currentHeldPitches ?? []
  }

  /** The exact pitches the play step is waiting for, octave included. */
  get expectedPlayPitches(): number[] {
    const question = this.currentQuestion
    return question ? question.notes.map((note) => note.midi) : []
  }

  /**
   * Naming the root, which in do major is naming the chord itself. Overridden
   * rather than inherited so it can only be given at the step that asks for it
   * and so it routes through the step machine.
   */
  answer(step: string, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question || this.currentStep !== 'root') {
      return 'done'
    }
    return this.submit(
      step.toUpperCase() === question.step,
      latinNameOf(question.step),
      latinNameOf(step),
      now,
    )
  }

  /**
   * Judge a quality. The confusion stats therefore read "shown a minor,
   * answered diminished", which is the most useful number this drill produces:
   * which pair of chords is actually being mixed up.
   */
  answerQuality(quality: ChordQuality, now = Date.now()): QuizAnswerResult {
    const question = this.currentQuestion
    if (!question || this.currentStep !== 'quality') {
      return 'done'
    }
    return this.submit(
      quality === question.quality,
      chordQualityLabel(question.quality),
      chordQualityLabel(quality),
      now,
    )
  }

  /**
   * One key of the played chord. `wrong` says the key is not in the chord (at
   * this octave) and clears whatever was held, `waiting` that the chord is not
   * complete yet; neither touches the stats.
   */
  playNote(pitch: number, now = Date.now()): ChordPlayResult {
    const question = this.currentQuestion
    if (!question || this.currentStep !== 'play' || !this.play) {
      return 'done'
    }
    const status = this.play.noteOn(pitch, now)
    if (status === 'error') {
      return 'wrong'
    }
    if (status !== 'done') {
      return 'waiting'
    }
    // Correct, so the label is never read (judge only records the wrong ones),
    // but it is the chord's own name rather than a placeholder in case that
    // ever stops being true.
    const label = chordName(question)
    return this.submit(true, label, label, now)
  }

  /**
   * Record one step's answer and move on: to the next step of the same
   * question, or -- on the last one -- to the next question.
   */
  private submit(
    correct: boolean,
    expected: string,
    played: string,
    now: number,
  ): QuizAnswerResult {
    const isLast = this.stepIndex >= this.steps.length - 1
    const result = this.judge(correct, expected, played, now, isLast)
    if (result === 'wrong') {
      return 'wrong'
    }
    this.stepIndex = isLast ? 0 : this.stepIndex + 1
    this.play = null
    // A finished question restarts the clock in `judge`, so nothing timed has
    // happened yet when the NEXT question's first step is entered.
    this.enterStep(isLast ? null : now)
    return result
  }

  /**
   * Arm the step now being asked. The play step is the only one with anything
   * to arm: its own `WaitEngine`, and the response clock stopping before it.
   */
  private enterStep(timedUntil: number | null): void {
    if (this.steps[this.stepIndex] !== 'play') {
      return
    }
    this.stopResponseClock(timedUntil)
    const question = this.currentQuestion
    this.play = question
      ? new WaitEngine([
          {
            index: 0,
            pitches: question.notes.map((note) => note.midi),
            measureNumber: question.measureNumber,
          },
        ])
      : null
  }
}
