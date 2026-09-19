/**
 * The chord-reading drill: a triad on a staff, and buttons to name it.
 *
 * A question is asked in up to three steps (`ChordAnswerStep`), and the screen
 * is a small machine over them: the root among the seven note names, then the
 * quality among three, then the chord PLAYED on a real MIDI keyboard. The staff
 * does not move between the steps -- it is one chord being read one answer at a
 * time -- and only the last chosen step advances to the next chord.
 *
 * Three things the steps make the screen responsible for:
 *
 * - **A miss reveals only what the step it was given at asked for.** Revealing
 *   "re minor" when the root was missed would hand the quality step its answer,
 *   and the spelled-out notes would hand over both. So the full name and the
 *   notes only appear once nothing is left to leak.
 * - **The played chord's keys are not highlighted until they are revealed**, for
 *   the same reason the reading quiz does not highlight its answer: the
 *   highlight also drives the keyboard's own follow-the-notes scroll, so
 *   lighting the keys would point at them even off screen. The keyboard opens
 *   on the clef's register rather than on the chord, since the step asks for the
 *   exact octave.
 * - **The chord's name is shown during the play step** once a naming step has
 *   already answered it, because binding that name to a position under the hands
 *   is the entire purpose of the step. In a play-only round nothing is shown:
 *   there, reading the stack is still the question.
 *
 * Everything else is the reading quiz's screen: no cursor, no WaitEngine for
 * navigation, one OSMD instance for the whole round with the current measure
 * cropped in (`ReadingStaff`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChordQualityButtons } from '../components/ChordQualityButtons'
import { MidiDevice } from '../components/MidiDevice'
import { NoteNameButtons } from '../components/NoteNameButtons'
import { ReadingStaff } from '../components/ReadingStaff'
import type { ReadingStaffHandle } from '../components/ReadingStaff'
import { RoundSummary } from '../components/RoundSummary'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { ChordQuizEngine } from '../engine/ChordQuizEngine'
import type { QuizAnswerResult } from '../engine/ChordQuizEngine'
import {
  chordInversionLabel,
  chordName,
  chordNotesLabel,
  chordNoteWindowPitches,
  chordRootLabel,
  createChordRound,
} from '../engine/chordQuiz'
import { chordSessionTitle, createSessionId } from '../engine/sessionLog'
import { useQuizSession } from '../hooks/useQuizSession'
import type { QuizSessionFrame } from '../hooks/useQuizSession'
import { PAGE_BACKGROUND, PAGE_CARD } from '../theme'
import type {
  ChordAnswerStep,
  ChordQuality,
  ChordQuestion,
  ChordQuizSettings,
} from '../types/chord'
import type { MidiDeviceInfo, MidiNoteEvent } from '../types/midi'
import type { PracticeSessionRecord } from '../types/session'

// Same feedback delay as the other two drills: the question does not advance,
// so this marks the miss rather than pausing anything.
const WRONG_FLASH_MS = 600

/** What each step is called on the progress pills. */
const STEP_LABELS: Record<ChordAnswerStep, string> = {
  root: 'Chord',
  quality: 'Quality',
  play: 'Play it',
}

interface ChordQuizProps {
  settings: ChordQuizSettings
  onNoteEvent: (listener: (event: MidiNoteEvent) => void) => () => void
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  isSupported: boolean
  midiError: string | null
  onBack: () => void
}

/**
 * "re minor, 1st inversion -- the ii of do major": the answer as it is worth
 * remembering. The position is named even when it is root, because a miss on an
 * inverted chord is usually a miss about *which note was the root*, and being
 * told the stack was in root position is the other half of that lesson.
 *
 * The degree is only appended for do major's own seven. A chord with an
 * accidental has no degree here, and printing one would name a key the round is
 * not in.
 */
function chordAnswerLabel(question: ChordQuestion): string {
  const degree = question.degree === null ? '' : ` — the ${question.degree} of do major`
  return `${chordName(question)}, ${chordInversionLabel(question.inversion)}${degree}`
}

export function ChordQuiz({
  settings,
  onNoteEvent,
  devices,
  selectedDeviceId,
  onSelectDevice,
  isSupported,
  midiError,
  onBack,
}: ChordQuizProps) {
  // A new seed per round, like the other drills: replaying must not replay the
  // same twenty chords in the same order.
  const [roundSeed, setRoundSeed] = useState(() => createSessionId())
  const round = useMemo(
    () => createChordRound({ ...settings, seed: roundSeed }),
    [settings, roundSeed],
  )
  const staffRef = useRef<ReadingStaffHandle>(null)
  const engineRef = useRef(new ChordQuizEngine(round.questions, round.steps))
  const [state, setState] = useState(() => engineRef.current.state)
  // Every wrong answer given to the CURRENT step, so several misses all stay
  // marked rather than only the last one.
  const [wrongQualities, setWrongQualities] = useState<ChordQuality[]>([])
  const [wrongSteps, setWrongSteps] = useState<string[]>([])
  const [wrongPlayPitches, setWrongPlayPitches] = useState<number[]>([])
  const [playHeld, setPlayHeld] = useState<number[]>([])
  const [revealed, setRevealed] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const wrongTimeoutRef = useRef<number | null>(null)

  const question = engineRef.current.currentQuestion
  const currentStep = engineRef.current.currentStep
  const keyboardWindow = useMemo(() => chordNoteWindowPitches(settings.clefMode), [settings.clefMode])

  const buildSessionRecord = (frame: QuizSessionFrame): PracticeSessionRecord => {
    const engine = engineRef.current
    const endedAt = Date.now()
    return {
      id: frame.id,
      startedAt: frame.startedAt,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - Date.parse(frame.startedAt),
      completed: frame.completed,
      // No practiceMode and no handMode: a quiz navigates nothing, and even the
      // play step is a chord under two hands rather than a score to read.
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

  // Each question is one measure of the round's single score, and it stays put
  // for every step of that question.
  useEffect(() => {
    if (question) {
      staffRef.current?.showMeasure(question.measureNumber)
    }
  }, [question])

  const clearFeedback = () => {
    setWrongQualities([])
    setWrongSteps([])
    setWrongPlayPitches([])
    setPlayHeld([])
    setRevealed(false)
  }

  const applyResult = (result: QuizAnswerResult, markWrong?: () => void) => {
    setState(engineRef.current.state)
    if (result === 'wrong') {
      setRevealed(true)
      markWrong?.()
      if (wrongTimeoutRef.current !== null) {
        clearTimeout(wrongTimeoutRef.current)
      }
      wrongTimeoutRef.current = window.setTimeout(() => {
        setWrongQualities([])
        setWrongSteps([])
        setWrongPlayPitches([])
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

  /** Naming the chord: the root's letter, which is what a chord is called. */
  const handleAnswerStep = (step: string) => {
    const engine = engineRef.current
    if (engine.state.completed) {
      return
    }
    applyResult(engine.answer(step), () =>
      setWrongSteps((current) => (current.includes(step) ? current : [...current, step])),
    )
  }

  // One listener for the whole screen, registered once: it reads the engine
  // through its ref, so it never closes over a stale question or a stale step.
  useEffect(() => {
    return onNoteEvent((event) => {
      if (event.type !== 'noteon') {
        return
      }
      const engine = engineRef.current
      if (engine.currentStep !== 'play') {
        return
      }
      const result = engine.playNote(event.pitch)
      setPlayHeld(engine.heldPlayPitches)
      if (result === 'waiting') {
        return
      }
      // A wrong key costs no stat (see ChordQuizEngine) but is shown where it
      // fell, so an octave slip reads as one rather than as "not that note".
      applyResult(result, () =>
        setWrongPlayPitches((current) =>
          current.includes(event.pitch) ? current : [...current, event.pitch],
        ),
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNoteEvent, persistSession])

  const startNewRound = () => {
    startNewSession()
    clearFeedback()
    setRoundSeed(createSessionId())
  }

  // A fresh round means a fresh engine, and the staff remounts with the new file.
  useEffect(() => {
    engineRef.current = new ChordQuizEngine(round.questions, round.steps)
    setState(engineRef.current.state)
  }, [round])

  const answered = state.answeredCount
  const total = round.questions.length
  // What a miss may say out loud: naming the chord while the quality is still
  // to be answered would answer it, and so would spelling out the three notes.
  const leaksLaterStep = currentStep === 'root' && round.steps.includes('quality')
  // The play step is where a name becomes a position under the hands -- but
  // only if a naming step has answered it. In a play-only round the stack is
  // still the question.
  const namesChordDuringPlay = currentStep === 'play' && round.steps.length > 1
  // Once the round is over there is no current step, but the keypad stays on
  // screen disabled under the summary rather than the layout collapsing: the
  // round's own first step decides which one that is.
  const keypadStep = currentStep ?? round.steps[0]

  return (
    <div className={`flex min-h-screen flex-col ${PAGE_BACKGROUND}`}>
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

      <main className="flex flex-1 flex-col gap-4 px-4 pb-4">
        <div className={`relative flex-1 overflow-hidden bg-white ${PAGE_CARD}`}>
          {staffError ? (
            <p className="p-4 text-sm text-rose-600">{staffError}</p>
          ) : (
            <ReadingStaff ref={staffRef} source={round.file} onError={setStaffError} />
          )}
          {revealed && question ? (
            <div className="absolute inset-x-0 bottom-0 bg-emerald-50/95 px-4 py-2 text-center">
              <p className="text-sm font-medium text-emerald-800">
                {leaksLaterStep
                  ? `${chordRootLabel(question)} — ${chordInversionLabel(question.inversion)}`
                  : chordAnswerLabel(question)}
              </p>
              {leaksLaterStep ? null : (
                <p className="text-xs text-emerald-700">{chordNotesLabel(question)}</p>
              )}
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

        {currentStep === 'play' && question ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-700">
                {namesChordDuringPlay
                  ? `Play ${chordAnswerLabel(question)}`
                  : 'Play the chord as written'}
              </p>
              <MidiDevice
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                onSelect={onSelectDevice}
                isSupported={isSupported}
                error={midiError}
              />
            </div>
            <VirtualKeyboard
              lowestPitch={keyboardWindow.low}
              highestPitch={keyboardWindow.high}
              expectedPitches={revealed ? engineRef.current.expectedPlayPitches : []}
              heldPitches={playHeld}
              wrongPitches={wrongPlayPitches}
            />
          </div>
        ) : revealed && question ? (
          /*
            The keys of a chord that was missed and is not going to be played:
            once it is named they are determined, so there is no knowledge left
            to test and showing them is the third step of reading a chord.
          */
          <VirtualKeyboard
            lowestPitch={question.notes[0].midi}
            highestPitch={question.notes[question.notes.length - 1].midi}
            expectedPitches={question.notes.map((note) => note.midi)}
            heldPitches={[]}
          />
        ) : null}

        {keypadStep === 'quality' ? (
          <ChordQualityButtons
            qualities={round.qualities}
            wrongQualities={wrongQualities}
            answerQuality={revealed ? (question?.quality ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerQuality}
          />
        ) : keypadStep === 'root' ? (
          <NoteNameButtons
            order={round.nameOrder}
            wrongSteps={wrongSteps}
            answerStep={revealed ? (question?.step ?? null) : null}
            disabled={state.completed}
            onAnswer={handleAnswerStep}
          />
        ) : null}
      </main>
    </div>
  )
}
