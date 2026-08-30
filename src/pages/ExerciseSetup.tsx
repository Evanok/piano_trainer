import { useState } from 'react'
import { isGuest } from '../api/auth'
import { MidiDevice } from '../components/MidiDevice'
import { StreakBadges } from '../components/StreakBadges'
import { RANDOM_KEY, TRAINING_KEY_NAMES } from '../engine/musicKeys'
import { hanonMidiRange, isHanonRangePlayable } from '../engine/hanonGenerator'
import { HANON_EXERCISE_NUMBERS } from '../engine/hanonPatterns'
import { midiToNoteName } from '../engine/noteNames'
import { latinNameOf, readingRange } from '../engine/readingQuiz'
import { getStreakStats } from '../engine/streak'
import { PAGE_BACKGROUND, PAGE_CARD, PRIMARY_BUTTON } from '../theme'
import type { MidiDeviceInfo } from '../types/midi'
import type { KeyboardAssistMode } from '../types/practice'
import type {
  ReadingAnswerMode,
  ReadingClefMode,
  ReadingLedgerLevel,
  ReadingQuizSettings,
} from '../types/reading'
import type {
  ExerciseKind,
  ExerciseRequest,
  HanonLength,
  HanonSettings,
  TrainingAccidentalMode,
  TrainingDifficulty,
  TrainingExerciseContentMode,
  TrainingExerciseSettings,
  TrainingHandMode,
  TrainingTonality,
} from '../types/training'

const OCTAVES = [1, 2, 3, 4, 5, 6, 7]

const HANON_OCTAVE_SHIFTS = [-2, -1, 0, 1, 2]

/**
 * "Reading" is a tab here, next to the two keyboard drills, because which drill
 * to do is a setting rather than an intent -- the same call ExerciseKind
 * already makes for Hanon. It is NOT an ExerciseKind though: the other two
 * build a MusicXML file and hand it to Practice, while a reading quiz has no
 * MIDI, no cursor and no WaitEngine, and goes to its own screen.
 */
type SetupTab = ExerciseKind | 'reading'

const EXERCISE_TABS: Array<{ kind: SetupTab; label: string }> = [
  { kind: 'generated', label: 'Generated drills' },
  { kind: 'hanon', label: 'Hanon' },
  { kind: 'reading', label: 'Reading' },
]

const READING_QUESTION_COUNTS = [10, 20, 30, 40]

/** "C4 (do)" -- the letter name the rest of the app uses, plus the quiz's own. */
function readingNoteLabel(midi: number): string {
  const name = midiToNoteName(midi)
  return `${name} (${latinNameOf(name.slice(0, 1))})`
}

interface ExerciseSetupProps {
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  isSupported: boolean
  midiError: string | null
  initialExerciseKind: ExerciseKind
  initialReadingSettings: ReadingQuizSettings
  initialSettings: TrainingExerciseSettings
  initialHanonSettings: HanonSettings
  initialKeyboardAssistMode: KeyboardAssistMode
  initialBackingTrackEnabled: boolean
  onExerciseReady: (
    request: ExerciseRequest,
    keyboardAssistMode: KeyboardAssistMode,
    backingTrackEnabled: boolean,
  ) => void
  onReadingReady: (settings: ReadingQuizSettings) => void
  onBack: () => void
}

export function ExerciseSetup({
  devices,
  selectedDeviceId,
  onSelectDevice,
  isSupported,
  midiError,
  initialExerciseKind,
  initialReadingSettings,
  initialSettings,
  initialHanonSettings,
  initialKeyboardAssistMode,
  initialBackingTrackEnabled,
  onExerciseReady,
  onReadingReady,
  onBack,
}: ExerciseSetupProps) {
  const [streak] = useState(() => getStreakStats())
  const [tab, setTab] = useState<SetupTab>(initialExerciseKind)
  const [readingSettings, setReadingSettings] = useState<ReadingQuizSettings>(initialReadingSettings)
  const [hanonSettings, setHanonSettings] = useState<HanonSettings>(initialHanonSettings)
  const [trainingHandMode, setTrainingHandMode] = useState<TrainingHandMode>(initialSettings.handMode)
  const [trainingDifficulty, setTrainingDifficulty] = useState<TrainingDifficulty>(initialSettings.difficulty)
  const [trainingContentMode, setTrainingContentMode] = useState<TrainingExerciseContentMode>(
    initialSettings.contentMode,
  )
  const [trainingAccidentalMode, setTrainingAccidentalMode] = useState<TrainingAccidentalMode>(
    initialSettings.accidentalMode,
  )
  const [trainingKey, setTrainingKey] = useState(initialSettings.key)
  const [trainingTonality, setTrainingTonality] = useState<TrainingTonality>(initialSettings.tonality)
  const [keyboardAssistMode, setKeyboardAssistMode] = useState<KeyboardAssistMode>(initialKeyboardAssistMode)
  // A backing track is several megabytes of audio per exercise, streamed from
  // the server, and a read-only visitor is here to see what the app does rather
  // than to drill in tempo. Off and hidden for them: the state starts false, so
  // nothing downstream (App's backingTrack, useBackingTrack) is ever asked for
  // a file, whatever the remembered setting was.
  const guest = isGuest()
  const [backingTrackEnabled, setBackingTrackEnabled] = useState(initialBackingTrackEnabled && !guest)
  const [trainingMeasureCount, setTrainingMeasureCount] = useState(initialSettings.measureCount)
  const [rightOctaveLow, setRightOctaveLow] = useState(initialSettings.rightOctaveLow)
  const [rightOctaveHigh, setRightOctaveHigh] = useState(initialSettings.rightOctaveHigh)
  const [leftOctaveLow, setLeftOctaveLow] = useState(initialSettings.leftOctaveLow)
  const [leftOctaveHigh, setLeftOctaveHigh] = useState(initialSettings.leftOctaveHigh)

  const handleStartTrainingExercise = () => {
    onExerciseReady(
      {
        kind: 'generated',
        settings: {
          handMode: trainingHandMode,
          accidentalMode: trainingAccidentalMode,
          difficulty: trainingDifficulty,
          contentMode: trainingContentMode,
          tonality: trainingTonality,
          key: trainingKey,
          measureCount: trainingMeasureCount,
          rightOctaveLow,
          rightOctaveHigh,
          leftOctaveLow,
          leftOctaveHigh,
        },
      },
      keyboardAssistMode,
      backingTrackEnabled,
    )
  }

  const handleStartHanonExercise = () => {
    onExerciseReady({ kind: 'hanon', settings: hanonSettings }, keyboardAssistMode, backingTrackEnabled)
  }

  const updateHanon = <Key extends keyof HanonSettings>(key: Key, value: HanonSettings[Key]) => {
    setHanonSettings((current) => ({ ...current, [key]: value }))
  }

  // "Ledger lines" says nothing about what will show up on screen, so the
  // setup names the actual notes the setting puts in play.
  const readingNoteRange = readingRange(readingSettings)
  const readingRangeLabel = `${readingNoteLabel(readingNoteRange.lowMidi)} to ${readingNoteLabel(readingNoteRange.highMidi)}`

  const hanonRange = hanonMidiRange(hanonSettings)
  const hanonFitsKeyboard = isHanonRangePlayable(hanonSettings)

  return (
    <div className={`min-h-screen ${PAGE_BACKGROUND}`}>
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col items-center gap-3 text-center">
          <div className="flex w-full items-center justify-between gap-4">
            <button type="button" onClick={onBack} className="text-sm font-medium text-indigo-600 hover:underline">
              Home
            </button>
            <h1 className="text-3xl font-semibold text-gray-900">Exercise</h1>
            <span className="w-10" />
          </div>
          <StreakBadges streak={streak} className="justify-center" />
        </header>

        <div className="flex w-full gap-2 rounded-xl border border-indigo-100 bg-white/70 p-1 shadow-sm">
          {EXERCISE_TABS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => setTab(item.kind)}
              className={
                tab === item.kind
                  ? 'flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm'
                  : 'flex-1 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-indigo-50 hover:text-indigo-700'
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'generated' ? (
          <section className={`flex w-full flex-col gap-4 p-5 ${PAGE_CARD}`}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium text-gray-900">Generated training</h2>
              <span className="text-xs text-gray-500">Randomly generated note drills</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Hands
                <select
                  value={trainingHandMode}
                  onChange={(event) => setTrainingHandMode(event.target.value as TrainingHandMode)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="right">Right hand</option>
                  <option value="left">Left hand</option>
                  <option value="both">Both hands</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Difficulty
                <select
                  value={trainingDifficulty}
                  onChange={(event) => setTrainingDifficulty(event.target.value as TrainingDifficulty)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Exercise type
                <select
                  value={trainingContentMode}
                  onChange={(event) => setTrainingContentMode(event.target.value as TrainingExerciseContentMode)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="notes">Notes</option>
                  <option value="triads">Triads</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Accidentals
                <select
                  value={trainingAccidentalMode}
                  onChange={(event) => setTrainingAccidentalMode(event.target.value as TrainingAccidentalMode)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="none">Natural notes only</option>
                  <option value="key">Key signatures</option>
                  <option value="chromatic">Chromatic passing notes</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Tonality
                <select
                  value={trainingTonality}
                  onChange={(event) => setTrainingTonality(event.target.value as TrainingTonality)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="major">Major</option>
                  <option value="minor">Minor</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Key
                {trainingAccidentalMode === 'none' ? (
                  <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                    {trainingTonality === 'major' ? 'C major' : 'A minor'} (natural notes only)
                  </span>
                ) : (
                  <select
                    value={trainingKey}
                    onChange={(event) => setTrainingKey(event.target.value)}
                    className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                  >
                    <option value={RANDOM_KEY}>Random</option>
                    {TRAINING_KEY_NAMES.map((keyName) => (
                      <option key={keyName} value={keyName}>
                        {keyName}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Length
                <select
                  value={trainingMeasureCount}
                  onChange={(event) => setTrainingMeasureCount(Number(event.target.value))}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value={4}>4 measures</option>
                  <option value={8}>8 measures</option>
                  <option value={16}>16 measures</option>
                  <option value={32}>32 measures</option>
                </select>
              </label>

            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              {trainingHandMode !== 'left' && (
                <>
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    RH low
                    <select
                      value={rightOctaveLow}
                      onChange={(event) => setRightOctaveLow(Math.min(Number(event.target.value), rightOctaveHigh))}
                      className="rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                    >
                      {OCTAVES.map((octave) => (
                        <option key={octave} value={octave}>
                          C{octave}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    RH high
                    <select
                      value={rightOctaveHigh}
                      onChange={(event) => setRightOctaveHigh(Math.max(Number(event.target.value), rightOctaveLow))}
                      className="rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                    >
                      {OCTAVES.map((octave) => (
                        <option key={octave} value={octave}>
                          B{octave}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {trainingHandMode !== 'right' && (
                <>
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    LH low
                    <select
                      value={leftOctaveLow}
                      onChange={(event) => setLeftOctaveLow(Math.min(Number(event.target.value), leftOctaveHigh))}
                      className="rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                    >
                      {OCTAVES.map((octave) => (
                        <option key={octave} value={octave}>
                          C{octave}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-gray-700">
                    LH high
                    <select
                      value={leftOctaveHigh}
                      onChange={(event) => setLeftOctaveHigh(Math.max(Number(event.target.value), leftOctaveLow))}
                      className="rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                    >
                      {OCTAVES.map((octave) => (
                        <option key={octave} value={octave}>
                          B{octave}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

          </section>
        ) : tab === 'hanon' ? (
          <section className={`flex w-full flex-col gap-4 p-5 ${PAGE_CARD}`}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium text-gray-900">Hanon</h2>
              <span className="text-xs text-gray-500">The Virtuoso Pianist, exercises 1-20</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Exercise
                <select
                  value={hanonSettings.exerciseNumber}
                  onChange={(event) => updateHanon('exerciseNumber', Number(event.target.value))}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  {HANON_EXERCISE_NUMBERS.map((number) => (
                    <option key={number} value={number}>
                      No. {number}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Hands
                <select
                  value={hanonSettings.handMode}
                  onChange={(event) => updateHanon('handMode', event.target.value as TrainingHandMode)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="both">Both hands (as written)</option>
                  <option value="right">Right hand</option>
                  <option value="left">Left hand</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Key
                <select
                  value={hanonSettings.key}
                  onChange={(event) => updateHanon('key', event.target.value)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  {TRAINING_KEY_NAMES.map((keyName) => (
                    <option key={keyName} value={keyName}>
                      {keyName} major{keyName === 'C' ? ' (as written)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Length
                <select
                  value={hanonSettings.length}
                  onChange={(event) => updateHanon('length', event.target.value as HanonLength)}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="full">Full (up and down)</option>
                  <option value="ascending">Ascending only</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Register
                <select
                  value={hanonSettings.octaveShift}
                  onChange={(event) => updateHanon('octaveShift', Number(event.target.value))}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  {HANON_OCTAVE_SHIFTS.map((shift) => (
                    <option key={shift} value={shift}>
                      {shift === 0 ? 'As written' : `${shift > 0 ? '+' : ''}${shift} octave${Math.abs(shift) === 1 ? '' : 's'}`}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-1 text-sm text-gray-700">
                Range
                <span
                  className={
                    hanonFitsKeyboard
                      ? 'rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500'
                      : 'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800'
                  }
                >
                  {midiToNoteName(hanonRange.low)} - {midiToNoteName(hanonRange.high)}
                  {hanonFitsKeyboard ? '' : ' (off an 88-key piano)'}
                </span>
              </div>
            </div>

            <p className="text-xs leading-5 text-gray-500">
              Hanon is finger technique, not a melody: one short figure walks up the scale a degree at a time, then
              back down. Both hands play it in parallel, an octave apart.
            </p>
          </section>
        ) : (
          <section className={`flex w-full flex-col gap-4 p-5 ${PAGE_CARD}`}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-medium text-gray-900">Reading quiz</h2>
              <span className="text-xs text-gray-500">No piano needed</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Answer with
                <select
                  value={readingSettings.answerMode}
                  onChange={(event) =>
                    setReadingSettings((current) => ({
                      ...current,
                      answerMode: event.target.value as ReadingAnswerMode,
                    }))
                  }
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="name">Note names (do re mi)</option>
                  <option value="key">Piano keys</option>
                </select>
                <span className="text-xs text-gray-500">
                  {readingSettings.answerMode === 'key'
                    ? 'Tap the key on the keyboard, octave included'
                    : 'Tap the name, the octave does not count'}
                </span>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Clef
                <select
                  value={readingSettings.clefMode}
                  onChange={(event) =>
                    setReadingSettings((current) => ({
                      ...current,
                      clefMode: event.target.value as ReadingClefMode,
                    }))
                  }
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="treble">Treble</option>
                  <option value="bass">Bass</option>
                  <option value="both">Both</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                How far outside the staff
                <select
                  value={readingSettings.ledgerLevel}
                  onChange={(event) =>
                    setReadingSettings((current) => ({
                      ...current,
                      ledgerLevel: Number(event.target.value) as ReadingLedgerLevel,
                    }))
                  }
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value={0}>Between the staff lines only</option>
                  <option value={1}>1 ledger line past it</option>
                  <option value={2}>2 ledger lines past it</option>
                  <option value={3}>3 ledger lines past it</option>
                </select>
                <span className="text-xs text-gray-500">
                  {readingRangeLabel} ({readingNoteRange.noteCount} notes)
                </span>
              </label>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Notes per round
                <select
                  value={readingSettings.questionCount}
                  onChange={(event) =>
                    setReadingSettings((current) => ({
                      ...current,
                      questionCount: Number(event.target.value),
                    }))
                  }
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  {READING_QUESTION_COUNTS.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="text-xs leading-5 text-gray-500">
              Name the note on screen. No MIDI keyboard and no piano needed, so this is the drill for a phone away
              from home. A ledger line is one of the short extra lines drawn above or below the staff for notes that
              no longer fit on it: the first one below the treble staff is middle C.
            </p>

            <button type="button" onClick={() => onReadingReady(readingSettings)} className={`self-start ${PRIMARY_BUTTON}`}>
              Start reading quiz
            </button>
          </section>
        )}

        {tab !== 'reading' && (
        <section className={`flex w-full flex-col gap-4 p-5 ${PAGE_CARD}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Keyboard help
              <select
                value={keyboardAssistMode}
                onChange={(event) => setKeyboardAssistMode(event.target.value as KeyboardAssistMode)}
                className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
              >
                <option value="none">No help</option>
                <option value="mistakes-only">Mistakes only</option>
                <option value="learning">Learning</option>
              </select>
            </label>

            {!guest && (
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                Backing track
                <select
                  value={backingTrackEnabled ? 'rhythm' : 'off'}
                  onChange={(event) => setBackingTrackEnabled(event.target.value === 'rhythm')}
                  className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none"
                >
                  <option value="off">Off</option>
                  <option value="rhythm">Bass + drums</option>
                </select>
              </label>
            )}
          </div>

          <button
            type="button"
            onClick={tab === 'hanon' ? handleStartHanonExercise : handleStartTrainingExercise}
            className={`self-start ${PRIMARY_BUTTON}`}
          >
            {tab === 'hanon' ? `Start Hanon No. ${hanonSettings.exerciseNumber}` : 'Start generated training'}
          </button>
        </section>
        )}

        {tab !== 'reading' && (
        <section className={`flex w-full flex-col items-center gap-2 px-4 py-4 ${PAGE_CARD}`}>
          <p className="text-sm font-medium text-gray-700">MIDI keyboard</p>
          <MidiDevice
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelect={onSelectDevice}
            isSupported={isSupported}
            error={midiError}
          />
        </section>
        )}
      </div>
    </div>
  )
}
