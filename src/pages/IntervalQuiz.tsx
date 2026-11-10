/**
 * The interval-reading drill: two notes on a staff, named in up to two steps
 * (the number, then the quality). Same screen as the chord drill without its
 * played step: one OSMD instance for the whole round, cropped to the current
 * measure by `ReadingStaff`, and the staff stays put across the steps of one
 * question.
 *
 * A miss reveals only what does not answer a step still to come: a missed
 * number shows the letters counted to find it ("do re mi"), which is the
 * method, and nothing about the quality. The full name, the semitones and the
 * two keys on a keyboard only appear once nothing is left to leak -- and the
 * keys are the point there, since a quality is a count of keys.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChoiceButtons } from '../components/ChoiceButtons'
import { ReadingStaff } from '../components/ReadingStaff'
import type { ReadingStaffHandle } from '../components/ReadingStaff'
import { RoundSummary } from '../components/RoundSummary'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { IntervalQuizEngine } from '../engine/IntervalQuizEngine'
import type { QuizAnswerResult } from '../engine/IntervalQuizEngine'
import {
  createIntervalRound,
  intervalCountedLetters,
  intervalName,
  intervalNoteLabel,
  intervalNumberLabel,
  intervalQualityLabel,
} from '../engine/intervalQuiz'
import { createSessionId, intervalSessionTitle } from '../engine/sessionLog'
import { useQuizSession } from '../hooks/useQuizSession'
import type { QuizSessionFrame } from '../hooks/useQuizSession'
import { PAGE_BACKGROUND, PAGE_CARD } from '../theme'
import type {
  IntervalAnswerStep,
  IntervalQuality,
  IntervalQuestion,
  IntervalQuizSettings,
} from '../types/interval'
import type { PracticeSessionRecord } from '../types/session'

const WRONG_FLASH_MS = 600

const STEP_LABELS: Record<IntervalAnswerStep, string> = {
  number: 'Number',
  quality: 'Quality',
}

interface IntervalQuizProps {
  settings: IntervalQuizSettings
  onBack: () => void
}

/** "major 3rd: do4 up to mi4, 4 semitones" */
function fullAnswerLabel(question: IntervalQuestion): string {
  const semitones = `${question.semitones} semitone${question.semitones === 1 ? '' : 's'}`
  return `${intervalName(question)}: ${intervalNoteLabel(question.lower)} up to ${intervalNoteLabel(question.upper)}, ${semitones}`
}

export function IntervalQuiz({ settings, onBack }: IntervalQuizProps) {
  const [roundSeed, setRoundSeed] = useState(() => createSessionId())
  const round = useMemo(
    () => createIntervalRound({ ...settings, seed: roundSeed }),
    [settings, roundSeed],
  )
  const staffRef = useRef<ReadingStaffHandle>(null)
  const engineRef = useRef(new IntervalQuizEngine(round.questions, round.steps))
  const [state, setState] = useState(() => engineRef.current.state)
  const [wrongNumbers, setWrongNumbers] = useState<number[]>([])
  const [wrongQualities, setWrongQualities] = useState<IntervalQuality[]>([])
  const [revealed, setRevealed] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const wrongTimeoutRef = useRef<number | null>(null)

  const question = engineRef.current.currentQuestion
  const currentStep = engineRef.current.currentStep

  const buildSessionRecord = (frame: QuizSessionFrame): PracticeSessionRecord => {
    const engine = engineRef.current
    const endedAt = Date.now()
    return {
      id: frame.id,
      startedAt: frame.startedAt,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - Date.parse(frame.startedAt),
      completed: frame.completed,
      source: {
        kind: 'interval',
        title: intervalSessionTitle(settings),
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

  useEffect(() => {
    if (question) {
      staffRef.current?.showMeasure(question.measureNumber)
    }
  }, [question])

  const clearFeedback = () => {
    setWrongNumbers([])
    setWrongQualities([])
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
        setWrongNumbers([])
        setWrongQualities([])
        wrongTimeoutRef.current = null
      }, WRONG_FLASH_MS)
      return
    }
    clearFeedback()
    if (result === 'done') {
      persistSession(true)
    }
  }

  const handleAnswerNumber = (number: number) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answerNumber(number), () =>
      setWrongNumbers((current) => (current.includes(number) ? current : [...current, number])),
    )
  }

  const handleAnswerQuality = (quality: IntervalQuality) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answerQuality(quality), () =>
      setWrongQualities((current) => (current.includes(quality) ? current : [...current, quality])),
    )
  }

  const startNewRound = () => {
    startNewSession()
    clearFeedback()
    setRoundSeed(createSessionId())
  }

  useEffect(() => {
    engineRef.current = new IntervalQuizEngine(round.questions, round.steps)
    setState(engineRef.current.state)
  }, [round])

  const answered = state.answeredCount
  const total = round.questions.length
  // A missed number with the quality still to come may only show the counting.
  const leaksLaterStep = currentStep === 'number' && round.steps.includes('quality')
  const keypadStep = currentStep ?? round.steps[0]

  return (
    // Exactly the screen's height, so the keyboard shown on a reveal takes its
    // room from the staff rather than pushing the answer buttons off a
    // landscape phone.
    <div className={`flex h-dvh flex-col ${PAGE_BACKGROUND}`}>
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-indigo-600 hover:underline">
          Back
        </button>
        <div className="flex items-center gap-2 text-xs font-semibold">
          {round.steps.length > 1 ? (
            <div className="flex items-center gap-1">
              {round.steps.map((step) => (
                <span
                  key={step}
                  className={`rounded-md border px-2 py-1 ${
                    step === currentStep
                      ? 'border-indigo-400 bg-indigo-100 text-indigo-800'
                      : 'border-gray-200 bg-white text-gray-400'
                  }`}
                >
                  {STEP_LABELS[step]}
                </span>
              ))}
            </div>
          ) : null}
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

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
        <div className={`relative min-h-0 flex-1 overflow-hidden bg-white ${PAGE_CARD}`}>
          {staffError ? (
            <p className="p-4 text-sm text-rose-600">{staffError}</p>
          ) : (
            // Out of the flow: ReadingStaff sizes its SVG in pixels from the
            // container, which would otherwise hold the card at its first size.
            <div className="absolute inset-0">
              <ReadingStaff ref={staffRef} source={round.file} onError={setStaffError} />
            </div>
          )}
          {state.completed ? (
            <RoundSummary
              successPercent={engineRef.current.successPercent}
              errorCount={state.errorCount}
              total={total}
              unit="intervals"
              onReplay={startNewRound}
              onBack={onBack}
            />
          ) : null}
        </div>

        {revealed && question ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-1.5 text-center text-sm font-medium text-emerald-800">
            {leaksLaterStep
              ? `${intervalNumberLabel(question.number)}: ${intervalCountedLetters(question)}`
              : fullAnswerLabel(question)}
          </p>
        ) : null}

        {revealed && question && !leaksLaterStep ? (
          // The quality is a count of keys, so once it is out the two keys are
          // shown to count them on.
          <VirtualKeyboard
            lowestPitch={question.lower.midi}
            highestPitch={question.upper.midi}
            expectedPitches={[question.lower.midi, question.upper.midi]}
            heldPitches={[]}
          />
        ) : null}

        {keypadStep === 'quality' ? (
          <ChoiceButtons
            choices={round.qualities}
            labelOf={intervalQualityLabel}
            wrongChoices={wrongQualities}
            answer={revealed ? (question?.quality ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerQuality}
          />
        ) : (
          <ChoiceButtons
            choices={round.numbers}
            labelOf={intervalNumberLabel}
            wrongChoices={wrongNumbers}
            answer={revealed ? (question?.number ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerNumber}
          />
        )}
      </main>
    </div>
  )
}
