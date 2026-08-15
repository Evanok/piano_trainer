import { useCallback, useEffect, useRef, useState } from 'react'
import { Home } from './pages/Home'
import { ExerciseSetup } from './pages/ExerciseSetup'
import { ScoreLibrary } from './pages/ScoreLibrary'
import { Stats } from './pages/Stats'
import { Practice } from './pages/Practice'
import { End } from './pages/End'
import { createTrainingExercise } from './engine/trainingGenerator'
import { createHanonExercise } from './engine/hanonGenerator'
import { useMidi } from './hooks/useMidi'
import { stopAllBackingTrackAudio } from './hooks/useBackingTrack'
import type {
  KeyboardAssistMode,
  PracticeBackingTrack,
  PracticeKeySignature,
  PracticeSourceKind,
} from './types/practice'
import type { SessionStats } from './types/session'
import type {
  ExerciseKind,
  ExerciseRequest,
  HanonSettings,
  TrainingExerciseSettings,
} from './types/training'

type Screen = 'home' | 'exercise-setup' | 'score-library' | 'stats' | 'practice' | 'end'

const DEFAULT_EXERCISE_SETTINGS: TrainingExerciseSettings = {
  handMode: 'right',
  accidentalMode: 'none',
  difficulty: 'easy',
  contentMode: 'notes',
  tonality: 'major',
  key: 'random',
  measureCount: 8,
  rightOctaveLow: 4,
  rightOctaveHigh: 5,
  leftOctaveLow: 2,
  leftOctaveHigh: 3,
}

const DEFAULT_HANON_SETTINGS: HanonSettings = {
  exerciseNumber: 1,
  handMode: 'both',
  key: 'C',
  octaveShift: 0,
  length: 'full',
}

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  // Tracks the screen we already have a browser-history entry for. Lets the
  // effect below tell "screen changed via a fresh navigation" apart from
  // "screen already matches the current history entry" -- the latter covers
  // both the initial mount and a screen change just caused by popstate (see
  // below), so no duplicate/conflicting entry gets pushed in either case. A
  // ref's initial value is computed once per component instance (not once
  // per effect invocation), which is what keeps this correct under
  // StrictMode's deliberate double-invoke of effects on mount (main.tsx) --
  // both invocations compare against the same untouched initial value.
  const lastHistoryScreenRef = useRef(screen)
  const [scoreFile, setScoreFile] = useState<File | null>(null)
  const [practiceSourceKind, setPracticeSourceKind] = useState<PracticeSourceKind>('score')
  const [keyboardAssistMode, setKeyboardAssistMode] = useState<KeyboardAssistMode>('learning')
  const [practiceBackingTrack, setPracticeBackingTrack] = useState<PracticeBackingTrack | null>(null)
  const [practiceKeySignature, setPracticeKeySignature] = useState<PracticeKeySignature | null>(null)
  const [exerciseKind, setExerciseKind] = useState<ExerciseKind>('generated')
  const [exerciseSettings, setExerciseSettings] = useState<TrainingExerciseSettings>(DEFAULT_EXERCISE_SETTINGS)
  const [hanonSettings, setHanonSettings] = useState<HanonSettings>(DEFAULT_HANON_SETTINGS)
  const [exerciseKeyboardAssistMode, setExerciseKeyboardAssistMode] = useState<KeyboardAssistMode>('none')
  const [exerciseBackingTrackEnabled, setExerciseBackingTrackEnabled] = useState(false)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)

  const { devices, selectedDeviceId, selectDevice, isSupported, error, onNoteEvent } = useMidi()

  // Establishes the base history entry for the app's current screen (so the
  // very first back-press has something defined to land on) and listens for
  // the user actually using the browser's back/forward buttons -- without
  // this, the whole app sits in one single history entry and back/forward
  // leaves the app instead of moving between screens.
  useEffect(() => {
    history.replaceState({ screen }, '', location.href)
    const onPopState = (event: PopStateEvent) => {
      const nextScreen = (event.state as { screen?: Screen } | null)?.screen ?? 'home'
      // Set before setScreen so the effect below sees them already in sync
      // on its next run and skips re-pushing what the browser just
      // navigated to.
      lastHistoryScreenRef.current = nextScreen
      setScreen(nextScreen)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every *forward* screen change (any of the existing setScreen(...) call
  // sites below, all unmodified) gets its own history entry, pushed here in
  // one place rather than at each call site.
  useEffect(() => {
    if (lastHistoryScreenRef.current === screen) {
      return
    }
    lastHistoryScreenRef.current = screen
    history.pushState({ screen }, '', location.href)
  }, [screen])

  // Safety net: only Practice ever plays a backing track, so any screen other
  // than practice should never have one running. A normal unmount already
  // stops it (see useBackingTrack's own cleanup), but this catches anything
  // that slips past that -- a leaked loop can't outlive its own screen.
  useEffect(() => {
    if (screen !== 'practice') {
      stopAllBackingTrackAudio()
    }
  }, [screen])

  const handleFileLoaded = useCallback(
    (
      file: File,
      sourceKind: PracticeSourceKind = 'score',
      assistMode?: KeyboardAssistMode,
      backingTrack: PracticeBackingTrack | null = null,
      keySignature: PracticeKeySignature | null = null,
    ) => {
      setScoreFile(file)
      setPracticeSourceKind(sourceKind)
      setKeyboardAssistMode(assistMode ?? (sourceKind === 'generated-training' ? 'none' : 'learning'))
      setPracticeBackingTrack(sourceKind === 'generated-training' ? backingTrack : null)
      setPracticeKeySignature(sourceKind === 'generated-training' ? keySignature : null)
      setScreen('practice')
    },
    [],
  )

  const startExercise = useCallback(
    (request: ExerciseRequest, assistMode: KeyboardAssistMode, backingTrackEnabled: boolean) => {
      // Hanon is deterministic on purpose -- no seed, so the same settings
      // always give the same exercise. Generated drills re-roll every time.
      const exercise =
        request.kind === 'hanon'
          ? createHanonExercise(request.settings)
          : createTrainingExercise({ ...request.settings, seed: String(Date.now()) })
      const backingTrack = backingTrackEnabled
        ? { enabled: true, keyName: exercise.keyName, tonicPitchClass: exercise.tonicPitchClass }
        : null

      setExerciseKind(request.kind)
      if (request.kind === 'hanon') {
        setHanonSettings(request.settings)
      } else {
        setExerciseSettings(request.settings)
      }
      setExerciseKeyboardAssistMode(assistMode)
      setExerciseBackingTrackEnabled(backingTrackEnabled)
      handleFileLoaded(exercise.file, 'generated-training', assistMode, backingTrack, {
        keyName: exercise.keyName,
        accidentalsLabel: exercise.accidentalsLabel,
      })
    },
    [handleFileLoaded],
  )

  const handleComplete = useCallback((stats: SessionStats) => {
    setSessionStats(stats)
    setScreen('end')
  }, [])

  const handleBackToHome = useCallback(() => {
    setScoreFile(null)
    setPracticeBackingTrack(null)
    setPracticeKeySignature(null)
    setSessionStats(null)
    setScreen('home')
  }, [])

  const handleNextExercise = useCallback(() => {
    setSessionStats(null)
    // A generated drill re-rolls; Hanon walks up the book instead, since
    // replaying the identical score is what "Back to start" already does.
    const request: ExerciseRequest =
      exerciseKind === 'hanon'
        ? { kind: 'hanon', settings: { ...hanonSettings, exerciseNumber: Math.min(hanonSettings.exerciseNumber + 1, 20) } }
        : { kind: 'generated', settings: exerciseSettings }
    startExercise(request, exerciseKeyboardAssistMode, exerciseBackingTrackEnabled)
  }, [
    exerciseBackingTrackEnabled,
    exerciseKeyboardAssistMode,
    exerciseKind,
    exerciseSettings,
    hanonSettings,
    startExercise,
  ])

  const handleChangeExerciseSettings = useCallback(() => {
    setScoreFile(null)
    setPracticeBackingTrack(null)
    setPracticeKeySignature(null)
    setSessionStats(null)
    setScreen('exercise-setup')
  }, [])

  if (screen === 'exercise-setup') {
    return (
      <ExerciseSetup
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={selectDevice}
        isSupported={isSupported}
        midiError={error}
        initialExerciseKind={exerciseKind}
        initialSettings={exerciseSettings}
        initialHanonSettings={hanonSettings}
        initialKeyboardAssistMode={exerciseKeyboardAssistMode}
        initialBackingTrackEnabled={exerciseBackingTrackEnabled}
        onExerciseReady={startExercise}
        onBack={handleBackToHome}
      />
    )
  }

  if (screen === 'score-library') {
    return (
      <ScoreLibrary
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={selectDevice}
        isSupported={isSupported}
        midiError={error}
        onFileLoaded={handleFileLoaded}
        onBack={handleBackToHome}
      />
    )
  }

  if (screen === 'stats') {
    return <Stats onBack={handleBackToHome} />
  }

  if (screen === 'practice' && scoreFile) {
    return (
      <Practice
        scoreFile={scoreFile}
        sourceKind={practiceSourceKind}
        keyboardAssistMode={keyboardAssistMode}
        backingTrack={practiceBackingTrack}
        keySignature={practiceKeySignature}
        onNoteEvent={onNoteEvent}
        onComplete={handleComplete}
        onBack={handleBackToHome}
        onExerciseSettings={practiceSourceKind === 'generated-training' ? handleChangeExerciseSettings : undefined}
      />
    )
  }

  if (screen === 'end' && sessionStats) {
    const isExerciseSession = practiceSourceKind === 'generated-training'
    return (
      <End
        stats={sessionStats}
        onHome={handleBackToHome}
        onNextExercise={isExerciseSession ? handleNextExercise : undefined}
        onChangeSettings={isExerciseSession ? handleChangeExerciseSettings : undefined}
      />
    )
  }

  return (
    <Home
      onStartExercise={() => setScreen('exercise-setup')}
      onPracticeScore={() => setScreen('score-library')}
      onViewStats={() => setScreen('stats')}
    />
  )
}

export default App
