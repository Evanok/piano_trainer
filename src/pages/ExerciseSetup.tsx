import { useState } from 'react'
import { MidiDevice } from '../components/MidiDevice'
import { getStreakStats } from '../engine/streakStore'
import type { MidiDeviceInfo } from '../types/midi'
import type { KeyboardAssistMode } from '../types/practice'
import type {
  TrainingAccidentalMode,
  TrainingDifficulty,
  TrainingExerciseSettings,
  TrainingHandMode,
} from '../types/training'

const OCTAVES = [1, 2, 3, 4, 5, 6, 7]

interface ExerciseSetupProps {
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  isSupported: boolean
  midiError: string | null
  initialSettings: TrainingExerciseSettings
  initialKeyboardAssistMode: KeyboardAssistMode
  initialBackingTrackEnabled: boolean
  onExerciseReady: (
    settings: TrainingExerciseSettings,
    keyboardAssistMode: KeyboardAssistMode,
    backingTrackEnabled: boolean,
  ) => void
  onBack: () => void
}

export function ExerciseSetup({
  devices,
  selectedDeviceId,
  onSelectDevice,
  isSupported,
  midiError,
  initialSettings,
  initialKeyboardAssistMode,
  initialBackingTrackEnabled,
  onExerciseReady,
  onBack,
}: ExerciseSetupProps) {
  const [streak] = useState(() => getStreakStats())
  const [trainingHandMode, setTrainingHandMode] = useState<TrainingHandMode>(initialSettings.handMode)
  const [trainingDifficulty, setTrainingDifficulty] = useState<TrainingDifficulty>(initialSettings.difficulty)
  const [trainingAccidentalMode, setTrainingAccidentalMode] = useState<TrainingAccidentalMode>(
    initialSettings.accidentalMode,
  )
  const [keyboardAssistMode, setKeyboardAssistMode] = useState<KeyboardAssistMode>(initialKeyboardAssistMode)
  const [backingTrackEnabled, setBackingTrackEnabled] = useState(initialBackingTrackEnabled)
  const [trainingMeasureCount, setTrainingMeasureCount] = useState(initialSettings.measureCount)
  const [rightOctaveLow, setRightOctaveLow] = useState(initialSettings.rightOctaveLow)
  const [rightOctaveHigh, setRightOctaveHigh] = useState(initialSettings.rightOctaveHigh)
  const [leftOctaveLow, setLeftOctaveLow] = useState(initialSettings.leftOctaveLow)
  const [leftOctaveHigh, setLeftOctaveHigh] = useState(initialSettings.leftOctaveHigh)

  const handleStartTrainingExercise = () => {
    onExerciseReady(
      {
        handMode: trainingHandMode,
        accidentalMode: trainingAccidentalMode,
        difficulty: trainingDifficulty,
        measureCount: trainingMeasureCount,
        rightOctaveLow,
        rightOctaveHigh,
        leftOctaveLow,
        leftOctaveHigh,
      },
      keyboardAssistMode,
      backingTrackEnabled,
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex w-full items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline">
            Home
          </button>
          <h1 className="text-3xl font-semibold text-gray-900">Exercise</h1>
          <span className="w-10" />
        </div>
        {streak.totalDaysPracticed > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-gray-600">
            <span>
              {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'} streak
            </span>
            <span>
              Longest: {streak.longestStreak} day{streak.longestStreak === 1 ? '' : 's'}
            </span>
            <span>
              {streak.totalDaysPracticed} day{streak.totalDaysPracticed === 1 ? '' : 's'} practiced total
            </span>
          </div>
        )}
      </header>

      <section className="flex w-full flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-medium text-gray-900">Generated training</h2>
          <span className="text-xs text-gray-500">Musical note drills</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Hands
            <select
              value={trainingHandMode}
              onChange={(event) => setTrainingHandMode(event.target.value as TrainingHandMode)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Accidentals
            <select
              value={trainingAccidentalMode}
              onChange={(event) => setTrainingAccidentalMode(event.target.value as TrainingAccidentalMode)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="none">Natural notes only</option>
              <option value="key">Key signatures</option>
              <option value="chromatic">Chromatic passing notes</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Length
            <select
              value={trainingMeasureCount}
              onChange={(event) => setTrainingMeasureCount(Number(event.target.value))}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value={4}>4 measures</option>
              <option value={8}>8 measures</option>
              <option value={16}>16 measures</option>
              <option value={32}>32 measures</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Keyboard help
            <select
              value={keyboardAssistMode}
              onChange={(event) => setKeyboardAssistMode(event.target.value as KeyboardAssistMode)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="none">No help</option>
              <option value="mistakes-only">Mistakes only</option>
              <option value="learning">Learning</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Backing track
            <select
              value={backingTrackEnabled ? 'soft-pad' : 'off'}
              onChange={(event) => setBackingTrackEnabled(event.target.value === 'soft-pad')}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="off">Off</option>
              <option value="soft-pad">Soft tonal pad</option>
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
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
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
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
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
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
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
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
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

        <button
          type="button"
          onClick={handleStartTrainingExercise}
          className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Start generated training
        </button>
      </section>

      <section className="flex w-full flex-col items-center gap-2">
        <p className="text-sm font-medium text-gray-700">MIDI keyboard</p>
        <MidiDevice
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelect={onSelectDevice}
          isSupported={isSupported}
          error={midiError}
        />
      </section>
    </div>
  )
}
