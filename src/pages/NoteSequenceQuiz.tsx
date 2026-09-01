/**
 * The note-order drill: a note, a direction, and seven buttons.
 *
 * No staff, no MIDI, no piano, so it runs anywhere the reading quiz does. The
 * round is a chain (see `noteSequence.ts`): the note shown is the answer to the
 * question before, so the player walks the sequence instead of restarting from
 * a landmark every time.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { NoteNameButtons } from '../components/NoteNameButtons'
import { RoundSummary } from '../components/RoundSummary'
import { NamingQuizEngine } from '../engine/NamingQuizEngine'
import type { QuizAnswerResult } from '../engine/NamingQuizEngine'
import { createNoteSequenceRound } from '../engine/noteSequence'
import { latinNameOf } from '../engine/readingQuiz'
import { createSessionId, sequenceSessionTitle } from '../engine/sessionLog'
import { useQuizSession } from '../hooks/useQuizSession'
import type { QuizSessionFrame } from '../hooks/useQuizSession'
import { PAGE_BACKGROUND, PAGE_CARD } from '../theme'
import type { PracticeSessionRecord } from '../types/session'
import type { NoteSequenceQuestion, NoteSequenceSettings } from '../types/sequence'

// Same feedback delay as the reading quiz: the question does not advance, so
// this marks the miss rather than pausing anything.
const WRONG_FLASH_MS = 600

interface NoteSequenceQuizProps {
  settings: NoteSequenceSettings
  onBack: () => void
}

export function NoteSequenceQuiz({ settings, onBack }: NoteSequenceQuizProps) {
  const [roundSeed, setRoundSeed] = useState(() => createSessionId())
  const round = useMemo(
    () => createNoteSequenceRound({ ...settings, seed: roundSeed }),
    [settings, roundSeed],
  )
  const engineRef = useRef(new NamingQuizEngine(round.questions))
  const [state, setState] = useState(() => engineRef.current.state)
  const [wrongSteps, setWrongSteps] = useState<string[]>([])
  const [revealed, setRevealed] = useState(false)
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
      // No practiceMode and no handMode: nothing is navigated and no hand plays.
      source: {
        kind: 'sequence',
        title: sequenceSessionTitle(settings),
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

  const applyResult = (result: QuizAnswerResult, step: string) => {
    setState(engineRef.current.state)
    if (result === 'wrong') {
      setRevealed(true)
      setWrongSteps((current) => (current.includes(step) ? current : [...current, step]))
      if (wrongTimeoutRef.current !== null) {
        clearTimeout(wrongTimeoutRef.current)
      }
      wrongTimeoutRef.current = window.setTimeout(() => {
        setWrongSteps([])
        wrongTimeoutRef.current = null
      }, WRONG_FLASH_MS)
      return
    }
    setWrongSteps([])
    setRevealed(false)
    if (result === 'done') {
      persistSession(true)
    }
  }

  const handleAnswer = (step: string) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answer(step), step)
  }

  const startNewRound = () => {
    startNewSession()
    setWrongSteps([])
    setRevealed(false)
    setRoundSeed(createSessionId())
  }

  useEffect(() => {
    engineRef.current = new NamingQuizEngine(round.questions)
    setState(engineRef.current.state)
  }, [round])

  const answered = state.answeredCount
  const total = round.questions.length

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
          {question ? <SequencePrompt question={question} revealed={revealed} /> : null}
          {state.completed ? (
            <RoundSummary
              successPercent={engineRef.current.successPercent}
              errorCount={state.errorCount}
              total={total}
              unit="steps"
              onReplay={startNewRound}
              onBack={onBack}
            />
          ) : null}
        </div>

        <NoteNameButtons
          order={round.nameOrder}
          wrongSteps={wrongSteps}
          answerStep={revealed ? (question?.step ?? null) : null}
          disabled={state.completed}
          onAnswer={handleAnswer}
        />
      </main>
    </div>
  )
}

/**
 * The question, laid out the way the notes actually sit: going up puts the
 * unknown above the known note, going down puts it below. The arrow says it
 * again, and the caption a third time in words, because a single glyph is the
 * one thing that must never be misread here.
 */
function SequencePrompt({ question, revealed }: { question: NoteSequenceQuestion; revealed: boolean }) {
  // Positioned absolutely rather than sized with h-full: the card it fills is a
  // flex item with no height of its own, so a percentage height there collapses
  // to the content and leaves the prompt stuck at the top of an empty card.
  const up = question.direction === 'up'
  const known = (
    <span className="text-6xl font-bold text-gray-900 sm:text-7xl">{latinNameOf(question.from)}</span>
  )
  const unknown = (
    <span
      className={`text-5xl font-bold sm:text-6xl ${revealed ? 'text-emerald-600' : 'text-gray-300'}`}
    >
      {revealed ? latinNameOf(question.step) : '?'}
    </span>
  )
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6">
      {up ? unknown : known}
      <span aria-hidden className="text-3xl leading-none text-indigo-400">
        {up ? '↑' : '↓'}
      </span>
      {up ? known : unknown}
      <p className="pt-3 text-sm text-gray-500">
        {question.distance === 1 ? 'the next note' : 'two notes'} {up ? 'up' : 'down'}
      </p>
    </div>
  )
}
