import { useCallback, useEffect, useState } from 'react'
import { Home } from './pages/Home'
import { ExerciseSetup } from './pages/ExerciseSetup'
import { ScoreLibrary } from './pages/ScoreLibrary'
import { Stats } from './pages/Stats'
import { Practice } from './pages/Practice'
import { End } from './pages/End'
import { createTrainingExercise } from './engine/trainingGenerator'
import { useMidi } from './hooks/useMidi'
import { stopAllBackingTrackAudio } from './hooks/useBackingTrack'
import type {
  KeyboardAssistMode,
  PracticeBackingTrack,
  PracticeKeySignature,
  PracticeSourceKind,
} from './types/practice'
import type { SessionStats } from './types/session'
import type { TrainingExerciseSettings } from './types/training'

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

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [scoreFile, setScoreFile] = useState<File | null>(null)
  const [practiceSourceKind, setPracticeSourceKind] = useState<PracticeSourceKind>('score')
  const [keyboardAssistMode, setKeyboardAssistMode] = useState<KeyboardAssistMode>('learning')
  const [practiceBackingTrack, setPracticeBackingTrack] = useState<PracticeBackingTrack | null>(null)
  const [practiceKeySignature, setPracticeKeySignature] = useState<PracticeKeySignature | null>(null)
  const [exerciseSettings, setExerciseSettings] = useState<TrainingExerciseSettings>(DEFAULT_EXERCISE_SETTINGS)
  const [exerciseKeyboardAssistMode, setExerciseKeyboardAssistMode] = useState<KeyboardAssistMode>('none')
  const [exerciseBackingTrackEnabled, setExerciseBackingTrackEnabled] = useState(false)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)

  const { devices, selectedDeviceId, selectDevice, isSupported, error, onNoteEvent } = useMidi()

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

  const startGeneratedExercise = useCallback(
    (settings: TrainingExerciseSettings, assistMode: KeyboardAssistMode, backingTrackEnabled: boolean) => {
      const exercise = createTrainingExercise({ ...settings, seed: String(Date.now()) })
      const backingTrack = backingTrackEnabled
        ? { enabled: true, keyName: exercise.keyName, tonicPitchClass: exercise.tonicPitchClass }
        : null

      setExerciseSettings(settings)
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
    startGeneratedExercise(exerciseSettings, exerciseKeyboardAssistMode, exerciseBackingTrackEnabled)
  }, [exerciseBackingTrackEnabled, exerciseKeyboardAssistMode, exerciseSettings, startGeneratedExercise])

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
        initialSettings={exerciseSettings}
        initialKeyboardAssistMode={exerciseKeyboardAssistMode}
        initialBackingTrackEnabled={exerciseBackingTrackEnabled}
        onExerciseReady={startGeneratedExercise}
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
