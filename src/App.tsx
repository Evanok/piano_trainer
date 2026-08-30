import { useCallback, useEffect, useRef, useState } from 'react'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { ExerciseSetup } from './pages/ExerciseSetup'
import { ScoreLibrary } from './pages/ScoreLibrary'
import { Stats } from './pages/Stats'
import { Practice } from './pages/Practice'
import { ReadingQuiz } from './pages/ReadingQuiz'
import { End } from './pages/End'
import { createTrainingExercise } from './engine/trainingGenerator'
import { createHanonExercise } from './engine/hanonGenerator'
import { adoptGuestLinkToken, clearToken, fetchAuthStatus, isGuest, subscribeAuthRequired } from './api/auth'
import { useMidi } from './hooks/useMidi'
import { stopAllBackingTrackAudio } from './hooks/useBackingTrack'
import type {
  KeyboardAssistMode,
  PracticeBackingTrack,
  PracticeKeySignature,
  PracticeSourceKind,
} from './types/practice'
import { exerciseSessionTitle } from './engine/sessionLog'
import type { ReadingQuizSettings } from './types/reading'
import type { SessionSource, SessionStats } from './types/session'
import { DEFAULT_BROWSE_STATE, type CatalogBrowseState, type CatalogEntry } from './types/catalog'
import type {
  ExerciseKind,
  ExerciseRequest,
  HanonSettings,
  TrainingExerciseSettings,
} from './types/training'

type Screen =
  | 'home'
  | 'exercise-setup'
  | 'score-library'
  | 'stats'
  | 'practice'
  | 'reading-quiz'
  | 'end'

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

const DEFAULT_READING_SETTINGS: ReadingQuizSettings = {
  answerMode: 'name',
  clefMode: 'treble',
  ledgerLevel: 1,
  questionCount: 20,
  // Replaced by a fresh one per round in ReadingQuiz: a reading drill is only a
  // reading drill if the notes have not been seen in that order before.
  seed: 'reading',
}

const DEFAULT_HANON_SETTINGS: HanonSettings = {
  exerciseNumber: 1,
  handMode: 'both',
  key: 'C',
  octaveShift: 0,
  length: 'full',
}

/**
 * 'checking' only lasts one request. 'locked' shows the login screen; anything
 * else (no password configured, valid token, or an unreachable server) is
 * 'open' -- the API being down must not keep the player from practising, same
 * degradation the catalog already has.
 */
type AuthGate = 'checking' | 'locked' | 'open'

function App() {
  const [authGate, setAuthGate] = useState<AuthGate>('checking')
  // Read-only share-link session (see api/auth.ts). Held here rather than read
  // per screen so every screen agrees within one session, even though the
  // server is what actually enforces it.
  const [isGuestSession, setIsGuestSession] = useState(false)
  // Only the owner is ever told the guest token, and only when the server has a
  // guest password configured -- null means there is no link to hand out.
  const [guestToken, setGuestToken] = useState<string | null>(null)
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
  // Owned here (not inside ScoreLibrary) so it survives that component
  // unmounting when navigating away and back -- otherwise browsing the
  // catalog always resumed reset to page 1.
  const [catalogBrowseState, setCatalogBrowseState] = useState<CatalogBrowseState>(DEFAULT_BROWSE_STATE)
  const handleCatalogBrowseChange = useCallback((state: CatalogBrowseState) => {
    setCatalogBrowseState(state)
  }, [])
  const [practiceSourceKind, setPracticeSourceKind] = useState<PracticeSourceKind>('score')
  const [keyboardAssistMode, setKeyboardAssistMode] = useState<KeyboardAssistMode>('learning')
  const [practiceBackingTrack, setPracticeBackingTrack] = useState<PracticeBackingTrack | null>(null)
  const [practiceKeySignature, setPracticeKeySignature] = useState<PracticeKeySignature | null>(null)
  const [exerciseKind, setExerciseKind] = useState<ExerciseKind>('generated')
  const [exerciseSettings, setExerciseSettings] = useState<TrainingExerciseSettings>(DEFAULT_EXERCISE_SETTINGS)
  const [hanonSettings, setHanonSettings] = useState<HanonSettings>(DEFAULT_HANON_SETTINGS)
  const [exerciseKeyboardAssistMode, setExerciseKeyboardAssistMode] = useState<KeyboardAssistMode>('none')
  const [exerciseBackingTrackEnabled, setExerciseBackingTrackEnabled] = useState(false)
  const [readingSettings, setReadingSettings] = useState<ReadingQuizSettings>(DEFAULT_READING_SETTINGS)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)
  // Describes what the next practice session is of. Built here rather than in
  // Practice because only App knows where the file came from -- a catalog entry,
  // a one-off upload, or a generator it just ran.
  const [sessionSource, setSessionSource] = useState<SessionSource | null>(null)

  const { devices, selectedDeviceId, selectDevice, isSupported, error, onNoteEvent } = useMidi()

  // Asked once on mount, and again after a successful login.
  const refreshAuthGate = useCallback(async () => {
    try {
      const status = await fetchAuthStatus()
      if (status.required && !status.authenticated) {
        // A stored token the server no longer accepts (password changed, or a
        // revoked guest link) would otherwise keep failing every request
        // silently.
        clearToken()
        setIsGuestSession(false)
        setGuestToken(null)
        setAuthGate('locked')
        return
      }
      setIsGuestSession(status.role === 'guest')
      setGuestToken(status.guestToken)
      setAuthGate('open')
    } catch {
      // Unreachable server: fall back to what this device last knew about
      // itself, so an offline guest still gets the read-only screens rather
      // than the owner's.
      setIsGuestSession(isGuest())
      setAuthGate('open')
    }
  }, [])

  useEffect(() => {
    // Synchronously, before the first request goes out: a share link is only a
    // token in the address bar until this stores it.
    adoptGuestLinkToken()
    void refreshAuthGate()
    return subscribeAuthRequired(() => setAuthGate('locked'))
  }, [refreshAuthGate])

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
      source: SessionSource,
      sourceKind: PracticeSourceKind = 'score',
      assistMode?: KeyboardAssistMode,
      backingTrack: PracticeBackingTrack | null = null,
      keySignature: PracticeKeySignature | null = null,
    ) => {
      setScoreFile(file)
      setSessionSource(source)
      setPracticeSourceKind(sourceKind)
      setKeyboardAssistMode(assistMode ?? (sourceKind === 'generated-training' ? 'none' : 'learning'))
      setPracticeBackingTrack(sourceKind === 'generated-training' ? backingTrack : null)
      setPracticeKeySignature(sourceKind === 'generated-training' ? keySignature : null)
      setScreen('practice')
    },
    [],
  )

  // A score picked from the library carries its catalog entry; a one-off upload
  // that failed to save has none, so its file name is the only name it has.
  const handleScoreLoaded = useCallback(
    (file: File, entry?: CatalogEntry) => {
      handleFileLoaded(file, {
        kind: 'score',
        title: entry?.title ?? file.name,
        scoreName: file.name,
        catalogId: entry?.id ?? null,
      })
    },
    [handleFileLoaded],
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
      handleFileLoaded(
        exercise.file,
        {
          kind: 'exercise',
          title: exerciseSessionTitle(request, exercise.keyName),
          exercise: request,
          keyName: exercise.keyName,
        },
        'generated-training',
        assistMode,
        backingTrack,
        {
          keyName: exercise.keyName,
          accidentalsLabel: exercise.accidentalsLabel,
        },
      )
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

  // Same cleanup as handleBackToHome, but lands directly in the catalog
  // instead of the intent menu -- the catalogSearch/catalogDifficulty/
  // catalogFavoritesOnly/catalogPage state is untouched, so browsing resumes
  // where it was left off.
  const handleBackToCatalog = useCallback(() => {
    setScoreFile(null)
    setPracticeBackingTrack(null)
    setPracticeKeySignature(null)
    setSessionStats(null)
    setScreen('score-library')
  }, [])

  // scoreFile/practiceSourceKind/etc. are still exactly what they were for
  // the session that just ended -- re-entering Practice with them unchanged
  // is a plain replay, no re-fetch from the catalog needed.
  const handleReplayScore = useCallback(() => {
    setSessionStats(null)
    setScreen('practice')
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

  const startReadingQuiz = useCallback((settings: ReadingQuizSettings) => {
    setReadingSettings(settings)
    setScreen('reading-quiz')
  }, [])

  const handleChangeExerciseSettings = useCallback(() => {
    setScoreFile(null)
    setPracticeBackingTrack(null)
    setPracticeKeySignature(null)
    setSessionStats(null)
    setScreen('exercise-setup')
  }, [])

  if (authGate === 'checking') {
    return <div className="min-h-screen" />
  }

  if (authGate === 'locked') {
    return <Login onAuthenticated={() => void refreshAuthGate()} />
  }

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
        initialReadingSettings={readingSettings}
        onReadingReady={startReadingQuiz}
        onBack={handleBackToHome}
      />
    )
  }

  if (screen === 'reading-quiz') {
    return <ReadingQuiz settings={readingSettings} onBack={() => setScreen('exercise-setup')} />
  }

  if (screen === 'score-library') {
    return (
      <ScoreLibrary
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={selectDevice}
        isSupported={isSupported}
        midiError={error}
        onFileLoaded={handleScoreLoaded}
        onBack={handleBackToHome}
        initialBrowseState={catalogBrowseState}
        onBrowseStateChange={handleCatalogBrowseChange}
      />
    )
  }

  if (screen === 'stats') {
    return <Stats onBack={handleBackToHome} />
  }

  if (screen === 'practice' && scoreFile && sessionSource) {
    return (
      <Practice
        scoreFile={scoreFile}
        sourceKind={practiceSourceKind}
        sessionSource={sessionSource}
        keyboardAssistMode={keyboardAssistMode}
        backingTrack={practiceBackingTrack}
        keySignature={practiceKeySignature}
        onNoteEvent={onNoteEvent}
        onComplete={handleComplete}
        onBack={handleBackToHome}
        onBackToCatalog={practiceSourceKind === 'score' ? handleBackToCatalog : undefined}
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
        onReplay={!isExerciseSession ? handleReplayScore : undefined}
        onBackToCatalog={!isExerciseSession ? handleBackToCatalog : undefined}
      />
    )
  }

  return (
    <Home
      onStartExercise={() => setScreen('exercise-setup')}
      onPracticeScore={() => setScreen('score-library')}
      onViewStats={() => setScreen('stats')}
      isGuestSession={isGuestSession}
      guestToken={guestToken}
    />
  )
}

export default App
