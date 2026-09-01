import { useEffect, useMemo, useRef, useState } from 'react'
import { NoteNameButtons } from '../components/NoteNameButtons'
import { ReadingStaff } from '../components/ReadingStaff'
import type { ReadingStaffHandle } from '../components/ReadingStaff'
import { RoundSummary } from '../components/RoundSummary'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { ReadingQuizEngine } from '../engine/ReadingQuizEngine'
import { createReadingRound, readingRange } from '../engine/readingQuiz'
import { createSessionId, readingSessionTitle } from '../engine/sessionLog'
import { useQuizSession } from '../hooks/useQuizSession'
import type { QuizSessionFrame } from '../hooks/useQuizSession'
import { PAGE_BACKGROUND, PAGE_CARD } from '../theme'
import type { QuizAnswerResult } from '../engine/ReadingQuizEngine'
import type { PracticeSessionRecord } from '../types/session'
import type { ReadingQuizSettings } from '../types/reading'

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

  const question = engineRef.current.currentQuestion

  const buildSessionRecord = (frame: QuizSessionFrame): PracticeSessionRecord => {
    const engine = engineRef.current
    const endedAt = Date.now()
    return {
      id: frame.id,
      startedAt: frame.startedAt,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - Date.parse(frame.startedAt),
      completed: frame.completed,
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

  const { persist: persistSession, startNewSession } = useQuizSession(buildSessionRecord)

  useEffect(
    () => () => {
      if (wrongTimeoutRef.current !== null) {
        clearTimeout(wrongTimeoutRef.current)
      }
    },
    [],
  )

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

  const applyResult = (result: QuizAnswerResult, markWrong: () => void) => {
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

  const startNewRound = () => {
    startNewSession()
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
          <NoteNameButtons
            order={round.nameOrder}
            wrongSteps={wrongSteps}
            answerStep={revealed ? (question?.step ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswer}
          />
        )}
      </main>
    </div>
  )
}
