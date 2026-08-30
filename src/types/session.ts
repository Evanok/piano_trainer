import type { HandMode, PracticeMode } from './practice.ts'
import type { ReadingQuizSettings } from './reading.ts'
import type { ExerciseRequest } from './training.ts'

export interface ExerciseNoteStat {
  note: string
  count: number
}

export interface ExerciseConfusionStat {
  expected: string
  played: string
  count: number
}

export interface ExerciseSessionStats {
  responseCount: number
  averageResponseMs: number
  medianResponseMs: number
  slowestResponseMs: number
  missedNotes: ExerciseNoteStat[]
  wrongNotes: ExerciseNoteStat[]
  confusions: ExerciseConfusionStat[]
}

/** What the End screen shows for the session that just finished. */
export interface SessionStats {
  durationMs: number
  errorCount: number
  totalEvents: number
  successPercent: number
  maxCombo: number
  exercise?: ExerciseSessionStats
}

/**
 * What was being practiced, stored inside the session record itself so the
 * stats screen can describe a past session without looking anything up (a
 * catalog entry may since have been deleted, and a generated exercise never
 * existed anywhere but in memory).
 *
 * `title` is the human label computed when the session started: keeping it
 * denormalized means a later change to how exercises are named -- or to
 * `ExerciseRequest`'s own settings shape -- can't make old records unreadable.
 */
export type SessionSource =
  | {
      kind: 'score'
      title: string
      /** The file name OSMD was handed, kept as a stable-ish identity. */
      scoreName: string
      /** Catalog id when the score came from the library, null for a one-off upload. */
      catalogId: string | null
    }
  | {
      kind: 'exercise'
      title: string
      /** Exactly the payload ExerciseSetup produced, so a drill is fully reproducible. */
      exercise: ExerciseRequest
      /** Resolved key of the generated exercise ('random' is already rolled here). */
      keyName: string | null
    }
  | {
      /**
       * A keyboard-free reading quiz: notes named on screen, no MIDI, no
       * piano. Recorded in the same log as everything else so it feeds the
       * streak and syncs across devices, and kept as its own kind so the stats
       * screen can report reading time separately from time at the keyboard --
       * a week of quizzes must not read as a week of playing.
       */
      kind: 'reading'
      title: string
      settings: ReadingQuizSettings
    }

/**
 * One practice session, whatever it was: an exercise or a real score, finished
 * or abandoned. Written when the session starts and refreshed while it runs
 * (see sessionStore), so a session survives the app being killed mid-practice
 * -- which on a phone is the normal way of leaving, not an edge case.
 */
export interface PracticeSessionRecord {
  /** Stable across every write of the same session; the merge key when syncing. */
  id: string
  /** ISO-8601, UTC. */
  startedAt: string
  /**
   * ISO-8601, UTC. For a session still running (or one that was killed) this
   * is the last refresh, so `durationMs` is always meaningful rather than 0.
   */
  endedAt: string
  durationMs: number
  /** False for a session left before its last note -- kept, not discarded. */
  completed: boolean
  /** Absent for a reading quiz, which has no score to navigate and no hands. */
  practiceMode?: PracticeMode
  handMode?: HandMode
  source: SessionSource
  /** Playable events in the piece under the session's hand mode, or questions asked in a quiz. */
  totalEvents: number
  /** Events cleared, so an abandoned session still says how far it got. */
  eventsPlayed: number
  /**
   * High-water mark of the cursor during the session, which is what the
   * catalog's progress bar reads. `eventsPlayed` is the cursor's *final*
   * position instead, so it drops back when the player returns to an earlier
   * passage; that is right for "where did they stop", wrong for "how far did
   * they get". Optional: sessions recorded before this existed fall back to
   * `eventsPlayed`, which is the same number for a straight-through run.
   */
  furthestEventIndex?: number
  errorCount: number
  correctNoteCount: number
  /** First-try accuracy over the events actually reached; 0 when none were. */
  successPercent: number
  maxCombo: number
  /** Note-level detail, recorded for every session (exercise or real score). */
  notes: ExerciseSessionStats
}
