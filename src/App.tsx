import { useCallback, useState } from 'react'
import { Home } from './pages/Home'
import { Practice } from './pages/Practice'
import { End } from './pages/End'
import { useMidi } from './hooks/useMidi'
import type { PracticeSourceKind } from './types/practice'
import type { SessionStats } from './types/session'

type Screen = 'home' | 'practice' | 'end'

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [scoreFile, setScoreFile] = useState<File | null>(null)
  const [practiceSourceKind, setPracticeSourceKind] = useState<PracticeSourceKind>('score')
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)

  const { devices, selectedDeviceId, selectDevice, isSupported, error, onNoteEvent } = useMidi()

  const handleFileLoaded = useCallback((file: File, sourceKind: PracticeSourceKind = 'score') => {
    setScoreFile(file)
    setPracticeSourceKind(sourceKind)
    setScreen('practice')
  }, [])

  const handleComplete = useCallback((stats: SessionStats) => {
    setSessionStats(stats)
    setScreen('end')
  }, [])

  const handleBackToHome = useCallback(() => {
    setScoreFile(null)
    setSessionStats(null)
    setScreen('home')
  }, [])

  if (screen === 'practice' && scoreFile) {
    return (
      <Practice
        scoreFile={scoreFile}
        sourceKind={practiceSourceKind}
        onNoteEvent={onNoteEvent}
        onComplete={handleComplete}
        onBack={handleBackToHome}
      />
    )
  }

  if (screen === 'end' && sessionStats) {
    return <End stats={sessionStats} onRestart={handleBackToHome} />
  }

  return (
    <Home
      devices={devices}
      selectedDeviceId={selectedDeviceId}
      onSelectDevice={selectDevice}
      isSupported={isSupported}
      midiError={error}
      onFileLoaded={handleFileLoaded}
    />
  )
}

export default App
