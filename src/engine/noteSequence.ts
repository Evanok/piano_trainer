/**
 * Builds one round of the note-order drill.
 *
 * Every question JUMPS: the note is drawn fresh, unrelated to the one before.
 * A chained round (each question starting on the last answer) was tried first
 * and was worse -- knowing where the previous answer landed makes half of the
 * next question free, and walking the sequence is exactly the forwards recital
 * the drill is meant to replace.
 *
 * Pure and seeded, like every other generator here: same seed, same round.
 */
import { createSeededRng } from './musicKeys'
import { shuffleNameOrder, STEPS } from './readingQuiz'
import type {
  NoteSequenceDirection,
  NoteSequenceDistance,
  NoteSequenceQuestion,
  NoteSequenceSettings,
} from '../types/sequence'

export type { NoteSequenceDirection, NoteSequenceDistance, NoteSequenceQuestion, NoteSequenceSettings }

export interface NoteSequenceRound {
  questions: NoteSequenceQuestion[]
  /**
   * The steps the seven answer buttons carry, left to right, always shuffled.
   *
   * There is no scale-order option here, unlike the reading quiz: with the
   * buttons in do-re-mi order, "the next note up" is literally the button to
   * the right and "down" the one to the left, so the whole drill would be
   * answerable without knowing a single note name.
   */
  nameOrder: string[]
}

export const DEFAULT_NOTE_SEQUENCE_QUESTION_COUNT = 20

const DEFAULT_SETTINGS: NoteSequenceSettings = {
  // Downwards by default: naming the note ABOVE another is the one direction
  // everybody already has by heart, musician or not, so it drills nothing.
  direction: 'down',
  distance: 'second',
  questionCount: DEFAULT_NOTE_SEQUENCE_QUESTION_COUNT,
  seed: 'sequence',
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function sanitize(settings: Partial<NoteSequenceSettings>): NoteSequenceSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  return { ...merged, questionCount: clamp(Math.round(merged.questionCount), 1, 60) }
}

/** The note `distance` steps up or down from `step`, wrapping around the ring. */
export function stepAway(step: string, direction: 'up' | 'down', distance: 1 | 2): string {
  const index = STEPS.indexOf(step.toUpperCase())
  if (index < 0) {
    return step
  }
  const offset = direction === 'up' ? distance : -distance
  return STEPS[(index + offset + STEPS.length * 2) % STEPS.length]
}

export function createNoteSequenceRound(
  settings: Partial<NoteSequenceSettings>,
): NoteSequenceRound {
  const sanitized = sanitize(settings)
  const rng = createSeededRng(sanitized.seed)
  const questions: NoteSequenceQuestion[] = []
  // Only used to avoid asking about the same note twice running, which reads
  // like the screen failed to advance.
  let previousFrom: string | null = null

  for (let i = 0; i < sanitized.questionCount; i += 1) {
    let from = STEPS[Math.floor(rng() * STEPS.length)]
    for (let attempt = 0; attempt < 8 && from === previousFrom; attempt += 1) {
      from = STEPS[Math.floor(rng() * STEPS.length)]
    }
    const direction: 'up' | 'down' =
      sanitized.direction === 'mixed' ? (rng() < 0.5 ? 'up' : 'down') : sanitized.direction
    const distance: 1 | 2 =
      sanitized.distance === 'mixed' ? (rng() < 0.5 ? 1 : 2) : sanitized.distance === 'third' ? 2 : 1
    questions.push({
      index: i,
      from,
      direction,
      distance,
      step: stepAway(from, direction, distance),
    })
    previousFrom = from
  }

  return { questions, nameOrder: shuffleNameOrder(sanitized.seed) }
}
