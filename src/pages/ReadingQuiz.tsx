import { useEffect, useMemo, useRef, useState } from 'react'
import { isGuest } from '../api/auth'
import { ReadingStaff } from '../components/ReadingStaff'
import type { ReadingStaffHandle } from '../components/ReadingStaff'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { computeGrade } from '../engine/grade'
import { ReadingQuizEngine } from '../engine/ReadingQuizEngine'
import { createReadingRound, LATIN_NAMES, readingRange } from '../engine/readingQuiz'
import { createSessionId, readingSessionTitle } from '../engine/sessionLog'
import { saveSession } from '../engine/sessionStore'
import { PAGE_BACKGROUND, PAGE_CARD, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../theme'
import type { ReadingAnswerResult } from '../engine/ReadingQuizEngine'
import type { PracticeSessionRecord } from '../types/session'
import type { ReadingQuizSettings } from '../types/reading'

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

// Same cadence as the practice screen: a phone leaves by having its tab killed,
// which runs no cleanup, so the record has to already be on disk.
const SESSION_HEARTBEAT_MS = 15000

// How long a wrong answer stays marked on the button that was pressed. The
// question itself does not advance, so this is feedback, not a delay.
const WRONG_FLASH_MS = 600

interface ReadingQuizProps {
  settings: ReadingQuizSettings
  onBack: () => void
}

export function ReadingQuiz({ settings, onBack }: ReadingQuizProps) {
  // A new seed per round: the point of the drill is notes never seen in that
  // order before, so replaying must not replay the same twenty questions.
  const [roundSeed, setRoundSeed] = useState(() => createSessionId())
  const round = useMemo(
    () => createReadingRound({ ...settings, seed: roundSeed }),
    [settings, roundSeed],
  )
  const staffRef = useRef<ReadingStaffHandle>(null)
  const engineRef = useRef(new ReadingQuizEngine(round.questions))
  const [state, setState] = useState(() => engineRef.current.state)
  // The wrong answers given to the CURRENT question, kept so several misses all
  // stay marked rather than only the last one.
  const [wrongSteps, setWrongSteps] = useState<string[]>([])
  const [wrongPitches, setWrongPitches] = useState<number[]>([])
  // Shown as soon as the first attempt is wrong: a quiz that only ever says
  // "no" teaches nothing, and accuracy already counts first attempts only, so
  // showing the answer afterwards costs the stats nothing.
  const [revealed, setRevealed] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const wrongTimeoutRef = useRef<number | null>(null)

  const sessionIdRef = useRef(createSessionId())
  const sessionStartedAtRef = useRef(new Date().toISOString())
  const sessionCompletedRef = useRef(false)

  const question = engineRef.current.currentQuestion

  const buildSessionRecord = (completed: boolean): PracticeSessionRecord => {
    const engine = engineRef.current
    const endedAt = Date.now()
    return {
      id: sessionIdRef.current,
      startedAt: sessionStartedAtRef.current,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - Date.parse(sessionStartedAtRef.current),
      completed,
      // No practiceMode and no handMode: a quiz navigates nothing and is played
      // with no hands on a keyboard.
      source: {
        kind: 'reading',
        title: readingSessionTitle(settings),
        settings,
      },
      totalEvents: round.questions.length,
      eventsPlayed: engine.state.answeredCount,
      errorCount: engine.state.errorCount,
      correctNoteCount: engine.state.correctCount,
      successPercent: engine.successPercent,
      maxCombo: engine.state.maxCombo,
      notes: engine.notesStats(),
    }
  }

  const persistSession = (completed: boolean) => {
    // A guest reads the owner's history rather than building one, exactly as on
    // the practice screen.
    if (isGuest()) {
      return
    }
    if (sessionCompletedRef.current) {
      return
    }
    sessionCompletedRef.current = completed
    saveSession(buildSessionRecord(completed))
  }

  useEffect(() => {
    persistSession(false)
    const heartbeat = setInterval(() => persistSession(false), SESSION_HEARTBEAT_MS)
    return () => {
      clearInterval(heartbeat)
      persistSession(false)
      if (wrongTimeoutRef.current !== null) {
        clearTimeout(wrongTimeoutRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each question is one measure of the round's single score.
  useEffect(() => {
    if (question) {
      staffRef.current?.showMeasure(question.measureNumber)
    }
  }, [question])

  const clearFeedback = () => {
    setWrongSteps([])
    setWrongPitches([])
    setRevealed(false)
  }

  const applyResult = (result: ReadingAnswerResult, markWrong: () => void) => {
    setState(engineRef.current.state)
    if (result === 'wrong') {
      setRevealed(true)
      markWrong()
      if (wrongTimeoutRef.current !== null) {
        clearTimeout(wrongTimeoutRef.current)
      }
      wrongTimeoutRef.current = window.setTimeout(() => {
        setWrongSteps([])
        setWrongPitches([])
        wrongTimeoutRef.current = null
      }, WRONG_FLASH_MS)
      return
    }
    clearFeedback()
    if (result === 'done') {
      persistSession(true)
    }
  }

  const handleAnswer = (step: string) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answer(step), () =>
      setWrongSteps((current) => (current.includes(step) ? current : [...current, step])),
    )
  }

  const handleAnswerPitch = (midi: number) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answerPitch(midi), () =>
      setWrongPitches((current) => (current.includes(midi) ? current : [...current, midi])),
    )
  }

  // Desktop shortcut: the seven answers on the number row, in scale order. Only
  // in name mode -- a key on the piano has no number-row equivalent.
  useEffect(() => {
    if (settings.answerMode === 'key') {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < STEPS.length) {
        handleAnswer(STEPS[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const startNewRound = () => {
    sessionIdRef.current = createSessionId()
    sessionStartedAtRef.current = new Date().toISOString()
    sessionCompletedRef.current = false
    clearFeedback()
    setRoundSeed(createSessionId())
  }

  // A fresh round means a fresh engine, and the staff remounts with the new file.
  useEffect(() => {
    engineRef.current = new ReadingQuizEngine(round.questions)
    setState(engineRef.current.state)
  }, [round])

  const answered = state.answeredCount
  const total = round.questions.length
  const range = readingRange(settings)

  return (
    <div className={`flex min-h-screen flex-col ${PAGE_BACKGROUND}`}>
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-indigo-600 hover:underline">
          Back
        </button>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">
            {Math.min(answered + 1, total)} / {total}
          </span>
          <span className="rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-orange-700">
            combo {state.combo}
          </span>
          <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
            {state.errorCount} wrong
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-4">
        <div className={`relative flex-1 overflow-hidden bg-white ${PAGE_CARD}`}>
          {staffError ? (
            <p className="p-4 text-sm text-rose-600">{staffError}</p>
          ) : (
            <ReadingStaff ref={staffRef} source={round.file} onError={setStaffError} />
          )}
          {state.completed ? <RoundSummary
            successPercent={engineRef.current.successPercent}
            errorCount={state.errorCount}
            total={total}
            onReplay={startNewRound}
            onBack={onBack}
          /> : null}
        </div>

        {settings.answerMode === 'key' ? (
          <VirtualKeyboard
            // The register in play, so the keyboard opens on it. Not a hint at
            // the answer: it is the same for every question of the round.
            lowestPitch={range.lowMidi}
            highestPitch={range.highMidi}
            // Nothing is highlighted until the answer is revealed, or the
            // keyboard would answer the question for the player -- and its
            // follow-the-notes scroll would point at it even off screen.
            expectedPitches={revealed && question ? [question.midi] : []}
            heldPitches={[]}
            wrongPitches={wrongPitches}
            onKeyPress={handleAnswerPitch}
          />
        ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {STEPS.map((step, index) => {
            const isWrong = wrongSteps.includes(step)
            const isAnswer = revealed && question?.step === step
            return (
              <button
                key={step}
                type="button"
                onClick={() => handleAnswer(step)}
                disabled={state.completed}
                className={`rounded-lg border py-4 text-base font-semibold shadow-sm transition-colors disabled:opacity-50 ${
                  isWrong
                    ? 'border-rose-300 bg-rose-100 text-rose-700'
                    : isAnswer
                      ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                      : 'border-indigo-200 bg-white text-gray-800 hover:bg-indigo-50'
                }`}
              >
                {LATIN_NAMES[index]}
              </button>
            )
          })}
        </div>
        )}
      </main>
    </div>
  )
}

function RoundSummary({
  successPercent,
  errorCount,
  total,
  onReplay,
  onBack,
}: {
  successPercent: number
  errorCount: number
  total: number
  onReplay: () => void
  onBack: () => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/95 p-6 text-center">
      <div className="text-6xl font-bold text-amber-600">{computeGrade(successPercent)}</div>
      <p className="text-sm text-gray-600">
        {successPercent}% first-try over {total} notes, {errorCount} wrong answer{errorCount === 1 ? '' : 's'}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onReplay} className={PRIMARY_BUTTON}>
          New round
        </button>
        <button type="button" onClick={onBack} className={SECONDARY_BUTTON}>
          Back
        </button>
      </div>
    </div>
  )
}
