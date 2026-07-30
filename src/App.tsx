import { useCallback, useState } from 'react'
import { Home } from './pages/Home'
import { ExerciseSetup } from './pages/ExerciseSetup'
import { ScoreLibrary } from './pages/ScoreLibrary'
import { Practice } from './pages/Practice'
import { End } from './pages/End'
import { useMidi } from './hooks/useMidi'
import type { KeyboardAssistMode, PracticeBackingTrack, PracticeSourceKind } from './types/practice'
import type { SessionStats } from './types/session'

type Screen = 'home' | 'exercise-setup' | 'score-library' | 'practice' | 'end'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [scoreFile, setScoreFile] = useState<File | null>(null)
  const [practiceSourceKind, setPracticeSourceKind] = useState<PracticeSourceKind>('score')
  const [keyboardAssistMode, setKeyboardAssistMode] = useState<KeyboardAssistMode>('learning')
  const [practiceBackingTrack, setPracticeBackingTrack] = useState<PracticeBackingTrack | null>(null)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)

  const { devices, selectedDeviceId, selectDevice, isSupported, error, onNoteEvent } = useMidi()

  const handleFileLoaded = useCallback(
    (
      file: File,
      sourceKind: PracticeSourceKind = 'score',
      assistMode?: KeyboardAssistMode,
      backingTrack: PracticeBackingTrack | null = null,
    ) => {
      setScoreFile(file)
      setPracticeSourceKind(sourceKind)
      setKeyboardAssistMode(assistMode ?? (sourceKind === 'generated-training' ? 'none' : 'learning'))
      setPracticeBackingTrack(sourceKind === 'generated-training' ? backingTrack : null)
      setScreen('practice')
    },
    [],
  )

  const handleComplete = useCallback((stats: SessionStats) => {
    setSessionStats(stats)
    setScreen('end')
  }, [])

  const handleBackToHome = useCallback(() => {
    setScoreFile(null)
    setSessionStats(null)
    setScreen('home')
  }, [])

  if (screen === 'exercise-setup') {
    return (
      <ExerciseSetup
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={selectDevice}
        isSupported={isSupported}
        midiError={error}
        onExerciseReady={(file, assistMode, backingTrack) =>
          handleFileLoaded(file, 'generated-training', assistMode, backingTrack)
        }
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

  if (screen === 'practice' && scoreFile) {
    return (
      <Practice
        scoreFile={scoreFile}
        sourceKind={practiceSourceKind}
        keyboardAssistMode={keyboardAssistMode}
        backingTrack={practiceBackingTrack}
        onNoteEvent={onNoteEvent}
        onComplete={handleComplete}
        onBack={handleBackToHome}
      />
    )
  }

  if (screen === 'end' && sessionStats) {
    return <End stats={sessionStats} onRestart={handleBackToHome} />
  }

  return <Home onStartExercise={() => setScreen('exercise-setup')} onPracticeScore={() => setScreen('score-library')} />
}

export default App
