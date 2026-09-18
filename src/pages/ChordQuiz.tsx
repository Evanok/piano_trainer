/**
 * The chord-reading drill: a triad on a staff, and buttons to name it.
 *
 * Two answer modes, and they are two different questions rather than two ways
 * of asking one. `chord` taps the chord's own name among the seven -- what
 * playing a piece written on chords actually asks for, and the one the drill
 * exists for. `quality` taps major/minor/diminished, the narrower drill. The
 * engine needs no branch for the first: `NamingQuizEngine.answer` already
 * judges the question's root, which is what naming the chord means in do major.
 *
 * The same screen as the reading quiz, minus the piano keyboard: no MIDI, no
 * cursor, no WaitEngine, one OSMD instance for the whole round with the current
 * measure cropped in (`ReadingStaff`). A wrong answer does not advance and
 * reveals the chord's full name instead, since a quiz that only ever says "no"
 * teaches nothing -- and first-try accuracy already counts the miss, so showing
 * the answer afterwards costs the stats nothing.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChordQualityButtons } from '../components/ChordQualityButtons'
import { NoteNameButtons } from '../components/NoteNameButtons'
import { ReadingStaff } from '../components/ReadingStaff'
import type { ReadingStaffHandle } from '../components/ReadingStaff'
import { RoundSummary } from '../components/RoundSummary'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { ChordQuizEngine } from '../engine/ChordQuizEngine'
import type { QuizAnswerResult } from '../engine/ChordQuizEngine'
import { chordInversionLabel, chordQualityLabel, createChordRound } from '../engine/chordQuiz'
import { latinNameOf } from '../engine/readingQuiz'
import { chordSessionTitle, createSessionId } from '../engine/sessionLog'
import { useQuizSession } from '../hooks/useQuizSession'
import type { QuizSessionFrame } from '../hooks/useQuizSession'
import { PAGE_BACKGROUND, PAGE_CARD } from '../theme'
import type { ChordQuality, ChordQuestion, ChordQuizSettings } from '../types/chord'
import type { PracticeSessionRecord } from '../types/session'

// Same feedback delay as the other two drills: the question does not advance,
// so this marks the miss rather than pausing anything.
const WRONG_FLASH_MS = 600

interface ChordQuizProps {
  settings: ChordQuizSettings
  onBack: () => void
}

const ALTER_SIGNS: Record<number, string> = { [-1]: '♭', 0: '', 1: '♯' }

/** "sol♯", the root as it is spoken: the letter carries its own accidental. */
function chordRootLabel(question: ChordQuestion): string {
  return `${latinNameOf(question.step)}${ALTER_SIGNS[question.rootAlter] ?? ''}`
}

/**
 * "re mineur, 1st inversion -- the ii of do major": the answer as it is worth
 * remembering. The position is named even when it is root, because a miss on an
 * inverted chord is usually a miss about *which note was the root*, and being
 * told the stack was in root position is the other half of that lesson.
 *
 * The degree is only appended for do major's own seven. A chord with an
 * accidental has no degree here, and printing one would name a key the round is
 * not in.
 */
function chordAnswerLabel(question: ChordQuestion): string {
  const name = `${chordRootLabel(question)} ${chordQualityLabel(question.quality)}`
  const degree = question.degree === null ? '' : ` — the ${question.degree} of do major`
  return `${name}, ${chordInversionLabel(question.inversion)}${degree}`
}

/** "sol – si♭ – ré", bottom to top: the three keys, spelled. */
function chordNotesLabel(question: ChordQuestion): string {
  return question.notes
    .map((note) => `${latinNameOf(note.step)}${ALTER_SIGNS[note.alter] ?? ''}`)
    .join(' – ')
}

export function ChordQuiz({ settings, onBack }: ChordQuizProps) {
  // A new seed per round, like the other drills: replaying must not replay the
  // same twenty chords in the same order.
  const [roundSeed, setRoundSeed] = useState(() => createSessionId())
  const round = useMemo(
    () => createChordRound({ ...settings, seed: roundSeed }),
    [settings, roundSeed],
  )
  const staffRef = useRef<ReadingStaffHandle>(null)
  const engineRef = useRef(new ChordQuizEngine(round.questions))
  const [state, setState] = useState(() => engineRef.current.state)
  // Every wrong answer given to the CURRENT question, so several misses all
  // stay marked rather than only the last one.
  const [wrongQualities, setWrongQualities] = useState<ChordQuality[]>([])
  const [wrongSteps, setWrongSteps] = useState<string[]>([])
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
        kind: 'chord',
        title: chordSessionTitle(settings),
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
    setWrongQualities([])
    setWrongSteps([])
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
        setWrongQualities([])
        setWrongSteps([])
        wrongTimeoutRef.current = null
      }, WRONG_FLASH_MS)
      return
    }
    clearFeedback()
    if (result === 'done') {
      persistSession(true)
    }
  }

  const handleAnswerQuality = (quality: ChordQuality) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answerQuality(quality), () =>
      setWrongQualities((current) => (current.includes(quality) ? current : [...current, quality])),
    )
  }

  /** Naming the chord: the inherited answer, which judges the root's letter. */
  const handleAnswerStep = (step: string) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answer(step), () =>
      setWrongSteps((current) => (current.includes(step) ? current : [...current, step])),
    )
  }

  const startNewRound = () => {
    startNewSession()
    clearFeedback()
    setRoundSeed(createSessionId())
  }

  // A fresh round means a fresh engine, and the staff remounts with the new file.
  useEffect(() => {
    engineRef.current = new ChordQuizEngine(round.questions)
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
          {staffError ? (
            <p className="p-4 text-sm text-rose-600">{staffError}</p>
          ) : (
            <ReadingStaff ref={staffRef} source={round.file} onError={setStaffError} />
          )}
          {revealed && question ? (
            <div className="absolute inset-x-0 bottom-0 bg-emerald-50/95 px-4 py-2 text-center">
              <p className="text-sm font-medium text-emerald-800">{chordAnswerLabel(question)}</p>
              <p className="text-xs text-emerald-700">{chordNotesLabel(question)}</p>
            </div>
          ) : null}
          {state.completed ? (
            <RoundSummary
              successPercent={engineRef.current.successPercent}
              errorCount={state.errorCount}
              total={total}
              unit="chords"
              onReplay={startNewRound}
              onBack={onBack}
            />
          ) : null}
        </div>

        {/*
          The third step of reading a chord -- finding the keys -- is SHOWN,
          never asked. Once the chord is named its keys are determined, so there
          is no knowledge left to test, only the physical mapping; and tapping a
          virtual keyboard was rejected as too imprecise to answer with. It
          appears only once the answer is out, so it can never give it away.
        */}
        {revealed && question ? (
          <VirtualKeyboard
            lowestPitch={question.notes[0].midi}
            highestPitch={question.notes[question.notes.length - 1].midi}
            expectedPitches={question.notes.map((note) => note.midi)}
            heldPitches={[]}
          />
        ) : null}

        {settings.answerMode === 'quality' ? (
          <ChordQualityButtons
            qualities={round.qualities}
            wrongQualities={wrongQualities}
            answerQuality={revealed ? (question?.quality ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerQuality}
          />
        ) : (
          <NoteNameButtons
            order={round.nameOrder}
            wrongSteps={wrongSteps}
            answerStep={revealed ? (question?.step ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerStep}
          />
        )}
      </main>
    </div>
  )
}
