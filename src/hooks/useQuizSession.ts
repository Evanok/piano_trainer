/**
 * Records a screen drill (reading quiz, note-order drill) as an ordinary
 * `PracticeSessionRecord`, so it feeds the streak, the sittings and the
 * cross-device sync exactly like a session at the keyboard.
 *
 * Shared by both drills because the cadence is the thing that matters and it is
 * easy to get subtly wrong: the record is written when the screen opens,
 * refreshed on a heartbeat while it is up, and refreshed again on unmount. On a
 * phone, closing the tab or switching apps runs no React cleanup, so "save at
 * the end" would lose both the session and its length.
 */
import { useCallback, useEffect, useRef } from 'react'
import { isGuest } from '../api/auth'
import { createSessionId } from '../engine/sessionLog'
import { saveSession } from '../engine/sessionStore'
import type { PracticeSessionRecord } from '../types/session'

// Same cadence as the practice screen.
const SESSION_HEARTBEAT_MS = 15000

/** What the caller needs from the hook to fill a record's own identity. */
export interface QuizSessionFrame {
  id: string
  startedAt: string
  completed: boolean
}

export interface QuizSession {
  /** Write the record. A completed one is never downgraded afterwards. */
  persist: (completed: boolean) => void
  /** A new round is a new session: fresh id, fresh start time. */
  startNewSession: () => void
}

export function useQuizSession(
  buildRecord: (frame: QuizSessionFrame) => PracticeSessionRecord,
): QuizSession {
  // Read through a ref so the heartbeat always builds from the current engine
  // state without re-registering the interval on every answer.
  const buildRef = useRef(buildRecord)
  buildRef.current = buildRecord

  const idRef = useRef(createSessionId())
  const startedAtRef = useRef(new Date().toISOString())
  const completedRef = useRef(false)

  const persist = useCallback((completed: boolean) => {
    // A guest reads the owner's history rather than building one, exactly as on
    // the practice screen.
    if (isGuest()) {
      return
    }
    // The heartbeat and the unmount that follows the summary both still fire
    // after the round is over, and must not turn a finished session unfinished.
    if (completedRef.current) {
      return
    }
    completedRef.current = completed
    saveSession(buildRef.current({ id: idRef.current, startedAt: startedAtRef.current, completed }))
  }, [])

  useEffect(() => {
    persist(false)
    const heartbeat = setInterval(() => persist(false), SESSION_HEARTBEAT_MS)
    return () => {
      clearInterval(heartbeat)
      persist(false)
    }
  }, [persist])

  const startNewSession = useCallback(() => {
    idRef.current = createSessionId()
    startedAtRef.current = new Date().toISOString()
    completedRef.current = false
  }, [])

  return { persist, startNewSession }
}
