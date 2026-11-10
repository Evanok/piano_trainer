/**
 * The rhythm-reading drill: one measure of rhythm with one note in orange,
 * placed in two steps (the beat, then where inside it). Same screen as the
 * interval drill: one OSMD instance for the whole round, cropped to the
 * current measure by `ReadingStaff`, and the staff stays put across the two
 * steps of a question.
 *
 * A missed beat reveals the beat only, which says nothing about the
 * subdivision still to come. Once the question is over (or the subdivision is
 * missed) the whole measure is counted out under the staff, "1 e & a 2 e & a",
 * with the positions where a note or a rest starts marked: that count is the
 * method the drill is meant to install.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChoiceButtons } from '../components/ChoiceButtons'
import { ReadingStaff } from '../components/ReadingStaff'
import type { ReadingStaffHandle } from '../components/ReadingStaff'
import { RoundSummary } from '../components/RoundSummary'
import { RhythmQuizEngine } from '../engine/RhythmQuizEngine'
import type { QuizAnswerResult } from '../engine/RhythmQuizEngine'
import {
  countSyllable,
  createRhythmRound,
  onsetsOf,
  positionLabel,
  RHYTHM_MEASURE_LENGTH,
  subdivisionLabel,
} from '../engine/rhythmQuiz'
import { createSessionId, rhythmSessionTitle } from '../engine/sessionLog'
import { useQuizSession } from '../hooks/useQuizSession'
import type { QuizSessionFrame } from '../hooks/useQuizSession'
import { PAGE_BACKGROUND, PAGE_CARD } from '../theme'
import type { RhythmAnswerStep, RhythmQuestion, RhythmQuizSettings, RhythmSubdivision } from '../types/rhythm'
import type { PracticeSessionRecord } from '../types/session'

const WRONG_FLASH_MS = 600

const BEATS = [1, 2, 3, 4]

const STEP_LABELS: Record<RhythmAnswerStep, string> = {
  beat: 'Beat',
  subdivision: 'Where in it',
}

interface RhythmQuizProps {
  settings: RhythmQuizSettings
  onBack: () => void
}

/**
 * The measure counted out position by position, the target in orange, a note
 * start in dark, a rest start struck through, every other position faint.
 */
function CountLine({ question, step }: { question: RhythmQuestion; step: number }) {
  const onsets = onsetsOf(question.durations)
  const starts = new Map(onsets.map((onset, index) => [onset, question.durations[index] > 0 ? 'note' : 'rest']))
  const positions: number[] = []
  for (let position = 0; position < RHYTHM_MEASURE_LENGTH; position += step) {
    positions.push(position)
  }
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-1.5 font-mono text-base">
      {positions.map((position) => {
        const start = starts.get(position)
        const className =
          position === question.onset
            ? 'rounded bg-orange-100 px-1 font-bold text-orange-700'
            : start === 'note'
              ? 'font-semibold text-gray-900'
              : start === 'rest'
                ? 'text-gray-400 line-through'
                : 'text-gray-300'
        // A little more room before each beat, so the count reads in groups.
        const gap = position > 0 && position % 4 === 0 ? 'ml-2' : ''
        return (
          <span key={position} className={`${className} ${gap}`}>
            {countSyllable(position)}
          </span>
        )
      })}
    </div>
  )
}

export function RhythmQuiz({ settings, onBack }: RhythmQuizProps) {
  const [roundSeed, setRoundSeed] = useState(() => createSessionId())
  const round = useMemo(() => createRhythmRound({ ...settings, seed: roundSeed }), [settings, roundSeed])
  const staffRef = useRef<ReadingStaffHandle>(null)
  const engineRef = useRef(new RhythmQuizEngine(round.questions, round.steps))
  const [state, setState] = useState(() => engineRef.current.state)
  const [wrongBeats, setWrongBeats] = useState<number[]>([])
  const [wrongSubdivisions, setWrongSubdivisions] = useState<RhythmSubdivision[]>([])
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
        kind: 'rhythm',
        title: rhythmSessionTitle(settings),
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
    setWrongBeats([])
    setWrongSubdivisions([])
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
        setWrongBeats([])
        setWrongSubdivisions([])
        wrongTimeoutRef.current = null
      }, WRONG_FLASH_MS)
      return
    }
    clearFeedback()
    if (result === 'done') {
      persistSession(true)
    }
  }

  const handleAnswerBeat = (beat: number) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answerBeat(beat), () =>
      setWrongBeats((current) => (current.includes(beat) ? current : [...current, beat])),
    )
  }

  const handleAnswerSubdivision = (subdivision: RhythmSubdivision) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answerSubdivision(subdivision), () =>
      setWrongSubdivisions((current) => (current.includes(subdivision) ? current : [...current, subdivision])),
    )
  }

  const startNewRound = () => {
    startNewSession()
    clearFeedback()
    setRoundSeed(createSessionId())
  }

  useEffect(() => {
    engineRef.current = new RhythmQuizEngine(round.questions, round.steps)
    setState(engineRef.current.state)
  }, [round])

  const answered = state.answeredCount
  const total = round.questions.length
  const keypadStep = currentStep ?? round.steps[0]
  // A missed beat with the subdivision still to come may only show the beat.
  const leaksLaterStep = currentStep === 'beat'
  // Counted in eighths while the level has no sixteenths, so the grid shows
  // only the positions a note can fall on.
  const countStep = round.subdivisions.length === 2 ? 2 : 1

  return (
    // Exactly the screen's height, so the count line shown on a reveal takes
    // its room from the staff rather than pushing the buttons off a phone.
    <div className={`flex h-dvh flex-col ${PAGE_BACKGROUND}`}>
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={onBack} className="text-sm font-medium text-indigo-600 hover:underline">
          Back
        </button>
        <div className="flex items-center gap-2 text-xs font-semibold">
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
              unit="notes"
              onReplay={startNewRound}
              onBack={onBack}
            />
          ) : null}
        </div>

        {!state.completed ? (
          <p className="text-center text-sm text-gray-600">
            {keypadStep === 'beat'
              ? 'Which beat does the orange note fall in?'
              : 'Where inside that beat?'}
          </p>
        ) : null}

        {revealed && question ? (
          <div className="flex flex-col gap-1 rounded-lg bg-emerald-50 px-4 py-1.5 text-center text-sm font-medium text-emerald-800">
            {leaksLaterStep ? (
              <span>Beat {question.beat}</span>
            ) : (
              <>
                <span>
                  Counted &quot;{positionLabel(question)}&quot;: beat {question.beat}
                  {question.subdivision === 'beat'
                    ? ', right on it'
                    : `, on its "${subdivisionLabel(question.subdivision)}"`}
                </span>
                <CountLine question={question} step={countStep} />
              </>
            )}
          </div>
        ) : null}

        {keypadStep === 'subdivision' ? (
          <ChoiceButtons
            choices={round.subdivisions}
            labelOf={subdivisionLabel}
            wrongChoices={wrongSubdivisions}
            answer={revealed ? (question?.subdivision ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerSubdivision}
          />
        ) : (
          <ChoiceButtons
            choices={BEATS}
            labelOf={(beat) => `Beat ${beat}`}
            wrongChoices={wrongBeats}
            answer={revealed ? (question?.beat ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerBeat}
          />
        )}
      </main>
    </div>
  )
}
