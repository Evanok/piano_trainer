import { useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import {
  HomeIcon,
  KeyboardIcon,
  LibraryIcon,
  PlayIcon,
  SettingsIcon,
  SkipToStartIcon,
  StopIcon,
} from '../components/icons'
import { isGuest } from '../api/auth'
import { PianoScore, type LayoutMode, type PianoScoreHandle } from '../components/PianoScore'
import { ComboOverlay, type ComboBreak } from '../components/ComboOverlay'
import { LoopRangeBar } from '../components/LoopRangeBar'
import { ScoreBusyOverlay } from '../components/ScoreBusyOverlay'
import { ScoreHud } from '../components/ScoreHud'
import { SuddenDeathCard, type SuddenDeathMiss } from '../components/SuddenDeathCard'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { handPitchesOf, NO_HAND_PITCHES } from '../engine/handPitches'
import { effectiveHandMode, extractExpectedEvents } from '../engine/ScoreParser'
import { extractTimedNotes } from '../engine/scorePlayback'
import { ScoreSynth } from '../engine/scoreSynth'
import { eventIndexAtOrAfterMeasure, lastMeasureNumber, sectionForMeasureRange, type Section } from '../engine/sections'
import { createSessionId } from '../engine/sessionLog'
import { saveSession } from '../engine/sessionStore'
import { DEFAULT_CHORD_TOLERANCE_MS, WaitEngine, type WaitEngineState } from '../engine/WaitEngine'
import { midiToNoteName } from '../engine/noteNames'
import { useIsMobile } from '../hooks/useIsMobile'
import { useBackingTrack } from '../hooks/useBackingTrack'
import { useWakeLock } from '../hooks/useWakeLock'
import type { ExpectedEvent } from '../types/score'
import type { MidiNoteEvent } from '../types/midi'
import type {
  HandMode,
  KeyboardAssistMode,
  PracticeBackingTrack,
  PracticeKeySignature,
  PracticeMode,
  PracticeSourceKind,
} from '../types/practice'
import type { ExerciseSessionStats, PracticeSessionRecord, SessionSource, SessionStats } from '../types/session'

const MAX_EXERCISE_STAT_ROWS = 3
/**
 * How long a wrong key stays red on the keyboard. Its own constant, not the
 * chord tolerance: the tolerance is a few hundred milliseconds, far too short
 * to see which key was hit.
 */
const WRONG_NOTE_DISPLAY_MS = 2000

/**
 * How often the in-progress session is rewritten to the log. A session is
 * recorded from its first second (not only when it ends) so leaving counts as
 * practice; this heartbeat is what keeps its duration honest when the app is
 * killed outright -- on a phone, closing the tab or switching away never runs a
 * React cleanup, so "save on unmount" alone would lose the session's length.
 */
const SESSION_HEARTBEAT_MS = 15000

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// Mobile's press-and-hold-on-the-staff cursor jump. Deliberately a long
// press rather than a tap: scroll mode's staff is horizontally draggable and
// a tap-to-jump would fire on every accidental brush of the screen
// mid-practice. Any finger movement past the tolerance cancels the pending
// press, so a scroll gesture can never turn into a jump.
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_TOLERANCE_PX = 12

/** Returned by runWhileBusy's work to keep the overlay up until the remounted score is ready. */
const WAIT_FOR_READY = 'wait-for-ready'

// Desktop starts in Page free, mobile in Scroll free, for real scores and
// generated exercises alike.
function defaultPracticeMode(_sourceKind: PracticeSourceKind, isMobile: boolean): PracticeMode {
  if (isMobile) {
    return 'scroll'
  }
  return 'page'
}

function incrementCount(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function topNoteStats(map: Map<number, number>) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_EXERCISE_STAT_ROWS)
    .map(([pitch, count]) => ({ note: midiToNoteName(pitch), count }))
}

function summarizeExerciseStats(
  responseTimesMs: number[],
  missedNoteCounts: Map<number, number>,
  wrongNoteCounts: Map<number, number>,
  confusionCounts: Map<string, { expected: string; played: string; count: number }>,
): ExerciseSessionStats {
  const sortedTimes = [...responseTimesMs].sort((a, b) => a - b)
  const responseCount = sortedTimes.length
  const medianIndex = Math.floor(responseCount / 2)
  const medianResponseMs =
    responseCount === 0
      ? 0
      : responseCount % 2 === 0
        ? Math.round((sortedTimes[medianIndex - 1] + sortedTimes[medianIndex]) / 2)
        : Math.round(sortedTimes[medianIndex])

  return {
    responseCount,
    averageResponseMs:
      responseCount === 0 ? 0 : Math.round(responseTimesMs.reduce((total, time) => total + time, 0) / responseCount),
    medianResponseMs,
    slowestResponseMs: responseCount === 0 ? 0 : Math.round(sortedTimes[responseCount - 1]),
    missedNotes: topNoteStats(missedNoteCounts),
    wrongNotes: topNoteStats(wrongNoteCounts),
    confusions: Array.from(confusionCounts.values())
      .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected) || a.played.localeCompare(b.played))
      .slice(0, MAX_EXERCISE_STAT_ROWS),
  }
}

interface PracticeProps {
  scoreFile: File
  sourceKind: PracticeSourceKind
  /** What is being practiced, stored verbatim in the session record. */
  sessionSource: SessionSource
  keyboardAssistMode: KeyboardAssistMode
  backingTrack: PracticeBackingTrack | null
  keySignature: PracticeKeySignature | null
  onNoteEvent: (listener: (event: MidiNoteEvent) => void) => () => void
  onComplete: (stats: SessionStats) => void
  onBack: () => void
  /** Score sessions only -- jumps straight to the catalog instead of Home. */
  onBackToCatalog?: () => void
  onExerciseSettings?: () => void
}

export function Practice({
  scoreFile,
  sourceKind,
  sessionSource,
  keyboardAssistMode,
  backingTrack,
  keySignature,
  onNoteEvent,
  onComplete,
  onBack,
  onBackToCatalog,
  onExerciseSettings,
}: PracticeProps) {
  const isMobile = useIsMobile()
  // Practice.tsx only mounts while the practice screen is active, so the lock
  // holds for the whole session and releases on its own when the component
  // unmounts (leaving the screen) -- see useWakeLock for why a phone locked
  // to sleep specifically during practice, since MIDI input generates no
  // touch/scroll activity for the OS to notice.
  useWakeLock(true)
  const [engineState, setEngineState] = useState<WaitEngineState | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [currentCombo, setCurrentCombo] = useState(0)
  const [bestCombo, setBestCombo] = useState(0)
  // Set only by a wrong note that ends a run, never by a jump or a hand switch
  // (those reset the combo too, but nothing was broken).
  const [comboBreak, setComboBreak] = useState<ComboBreak | null>(null)
  // A sudden-death run that just ended. While set, practice is frozen on the
  // missed event (notes are ignored) until the player retries, so the expected
  // note can be read off the score and the keyboard first.
  const [suddenDeathMiss, setSuddenDeathMiss] = useState<SuddenDeathMiss | null>(null)
  const suddenDeathMissRef = useRef<SuddenDeathMiss | null>(null)
  const setMiss = (miss: SuddenDeathMiss | null) => {
    suddenDeathMissRef.current = miss
    setSuddenDeathMiss(miss)
  }
  const [correctNoteCount, setCorrectNoteCount] = useState(0)
  const [totalEvents, setTotalEvents] = useState(0)
  const [currentMeasure, setCurrentMeasure] = useState(1)
  const [zoom, setZoomValue] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)
  // What the score overlay says while OSMD is busy laying the score out again,
  // null when it is not. Starts set: the first load is the longest freeze of all.
  const [busyLabel, setBusyLabel] = useState<string | null>('Loading score...')
  // The same flag, readable synchronously from event handlers (and the MIDI
  // handler) without waiting for a re-render.
  const busyRef = useRef(true)
  // What the header's controls show while their change waits for the overlay to
  // be painted: a controlled <select> would otherwise snap back to the old value
  // for the whole freeze, as if the click had not been taken.
  const [pendingSelection, setPendingSelection] = useState<{
    mode?: PracticeMode
    hand?: HandMode
  }>({})
  const [wrongNoteFeedback, setWrongNoteFeedback] = useState<string | null>(null)
  const [measureInputValue, setMeasureInputValue] = useState('')
  const [showKeyboard, setShowKeyboard] = useState(false)
  const [mobileKeyboardVisible, setMobileKeyboardVisible] = useState(true)
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false)
  // What drives navigation through the piece -- see PracticeMode. Computed
  // once at mount only: re-forcing a default whenever isMobile flips (resize,
  // rotation) would reintroduce the "state fights the user's choice" problem
  // this consolidation is meant to remove.
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(() => defaultPracticeMode(sourceKind, isMobile))
  // Which hand(s) are required to advance -- always starts at 'both'
  // regardless of platform/source/mode, and is a live control the player can
  // change mid-session (see handleSelectHandMode), not just a pre-practice
  // setting.
  const [handMode, setHandMode] = useState<HandMode>('both')
  const [expectedPitches, setExpectedPitches] = useState<number[]>([])
  const [heldPitches, setHeldPitches] = useState<number[]>([])
  const [pitchRange, setPitchRange] = useState({ low: 60, high: 72 })
  const [wrongPitches, setWrongPitches] = useState<number[]>([])
  // The same expected pitches, split by the hand they are written for, so the
  // virtual keyboard can show which hand plays what on top of the state
  // colours. Empty for a score with no unambiguous pair of hands, which is
  // exactly when there is nothing true to say about hands.
  const [expectedHandPitches, setExpectedHandPitches] = useState(NO_HAND_PITCHES)

  const [events, setEvents] = useState<ExpectedEvent[]>([])
  const [sectionMessage, setSectionMessage] = useState<string | null>(null)
  // Scroll loop's range, in measures. It starts as the whole piece, which
  // is what makes the mode behave exactly like plain Scroll until a bound is
  // actually moved. Kept in measure space rather than event indices so it
  // survives a hand-mode change, which renumbers every event.
  const [loopRange, setLoopRange] = useState({ start: 1, end: 1 })

  const totalMeasures = useMemo(() => lastMeasureNumber(events), [events])
  const isLoopMode = practiceMode === 'scrollLoop'
  // Null means "the whole piece", i.e. no crop and no looping: the default
  // range and a range dragged back out to both ends are the same thing.
  const loopSection = useMemo(() => {
    if (!isLoopMode || (loopRange.start <= 1 && loopRange.end >= totalMeasures)) {
      return null
    }
    return sectionForMeasureRange(events, loopRange.start, loopRange.end)
  }, [isLoopMode, loopRange, totalMeasures, events])

  const backing = useBackingTrack(sourceKind === 'generated-training' ? backingTrack : null)

  const scoreRef = useRef<PianoScoreHandle | null>(null)

  const endBusy = () => {
    busyRef.current = false
    setBusyLabel(null)
    setPendingSelection({})
  }

  /**
   * Runs work that re-renders the score, behind the overlay. The overlay is
   * shown first and the work only starts once a frame has been painted with
   * it: everything below blocks the main thread, so an overlay set in the same
   * task as the work would never reach the screen. Returning WAIT_FOR_READY
   * keeps the overlay up until PianoScore's onReady, for a switch that remounts
   * OSMD (page <-> scroll), whose real cost lands in that remount and not here.
   * A second request while one is pending is dropped rather than queued.
   */
  const runWhileBusy = (label: string, work: () => typeof WAIT_FOR_READY | void) => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusyLabel(label)
    // rAF runs just before the next paint; the timeout queued from it runs
    // after that paint, so the overlay is on screen by then.
    requestAnimationFrame(() => {
      setTimeout(() => {
        let waitForReady = false
        try {
          waitForReady = work() === WAIT_FOR_READY
        } finally {
          if (!waitForReady) {
            endBusy()
          }
        }
      }, 0)
    })
  }
  // Kept so handleSelectHandMode can re-walk the already-loaded OSMD instance
  // to recompute ExpectedEvents for the new hand mode, without asking
  // PianoScore to remount/reparse the file (a hand-mode switch shouldn't pay
  // that cost -- the graphical score doesn't change, only which notes are
  // required).
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const waitEngineRef = useRef<WaitEngine | null>(null)
  const previousIndexRef = useRef(0)
  const eventsWithErrorsRef = useRef<Set<number>>(new Set())
  // Highest event index the cursor ever advanced to this session, which is what
  // the catalog's progress bar reads. Only real advances move it, so jumping
  // around the score does not invent progress, and going back to an earlier
  // passage does not throw away what was already reached.
  const furthestIndexRef = useRef(0)
  const errorCountRef = useRef(0)
  const totalEventsRef = useRef(0)
  // comboRef: consecutive events completed with zero errors before
  // completion, reset the instant a wrong note lands (not only when the
  // event finally advances) so the on-screen counter drops immediately
  // rather than lagging behind the mistake. maxComboRef is the session's
  // best combo, reported in SessionStats -- never reset by a jump, only by
  // starting a new session.
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  // Whether the CURRENT attempt at the current event had a wrong note, which is
  // what the combo asks. Not eventsWithErrorsRef (any attempt this session,
  // what first-try accuracy asks): replaying a passage after a loop restart or
  // a sudden-death reset would otherwise never count towards the combo again.
  const currentEventErredRef = useRef(false)
  const correctNoteCountRef = useRef(0)
  const sourceKindRef = useRef(sourceKind)
  sourceKindRef.current = sourceKind
  const eventStartedAtRef = useRef(nowMs())
  const responseTimesRef = useRef<number[]>([])
  const missedNoteCountsRef = useRef<Map<number, number>>(new Map())
  const wrongNoteCountsRef = useRef<Map<number, number>>(new Map())
  const confusionCountsRef = useRef<Map<string, { expected: string; played: string; count: number }>>(new Map())
  const startedAtRef = useRef(Date.now())
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Lazily created on first Play press -- constructing an AudioContext
  // eagerly on mount would risk it starting in a suspended state on some
  // browsers before any user gesture has happened.
  const synthRef = useRef<ScoreSynth | null>(null)
  const sectionMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null)
  // The onNoteEvent effect below only runs once (stable deps), so it reads
  // practice-mode state through this ref rather than a stale closure value.
  const practiceModeRef = useRef(practiceMode)
  practiceModeRef.current = practiceMode
  // The range practice is currently confined to: Scroll loop's range, or
  // nothing at all. Every crop, every end-of-range check and every "back to
  // start" reads this one value.
  const activeBounds: Section | null = isLoopMode ? loopSection : null
  const activeBoundsRef = useRef<Section | null>(activeBounds)
  activeBoundsRef.current = activeBounds
  const handModeRef = useRef(handMode)
  handModeRef.current = handMode
  const sessionSourceRef = useRef(sessionSource)
  sessionSourceRef.current = sessionSource
  // One record per visit to this screen. Its own start time, separate from
  // startedAtRef: handleReady runs again on a PianoScore remount (a layout or
  // hand-mode change) and resets that one, but the session the player is in the
  // middle of is still the same session.
  const sessionIdRef = useRef(createSessionId())
  const sessionStartedAtRef = useRef(new Date().toISOString())
  const sessionCompletedRef = useRef(false)
  // Page free has no wait-gating and no cursor at all -- see PracticeMode's
  // doc comment. Every cursor-position control (back to start, go to measure,
  // the measure/event counter) is meaningless without a cursor to move, and
  // MIDI input is simply not tracked (see the onNoteEvent effect below).
  const isFreePageMode = practiceMode === 'page'
  const resolvedLayoutMode: LayoutMode = practiceMode === 'page' ? 'page' : 'scroll'

  const clearDecayTimer = () => {
    if (decayTimeoutRef.current !== null) {
      clearTimeout(decayTimeoutRef.current)
      decayTimeoutRef.current = null
    }
  }

  const showSectionMessage = (message: string) => {
    if (sectionMessageTimeoutRef.current !== null) {
      clearTimeout(sectionMessageTimeoutRef.current)
    }
    setSectionMessage(message)
    sectionMessageTimeoutRef.current = setTimeout(() => {
      setSectionMessage(null)
      sectionMessageTimeoutRef.current = null
    }, 3000)
  }

  const resetNoteStats = () => {
    eventStartedAtRef.current = nowMs()
    responseTimesRef.current = []
    missedNoteCountsRef.current = new Map()
    wrongNoteCountsRef.current = new Map()
    confusionCountsRef.current = new Map()
  }

  // Collected for real scores as well as generated exercises: the End screen
  // still only shows them for exercises (see finishSession), but the session log
  // keeps them either way so per-note stats can grow to cover scores later.
  const recordNoteError = (expectedPitchesForEvent: number[], playedPitch: number) => {
    expectedPitchesForEvent.forEach((pitch) => incrementCount(missedNoteCountsRef.current, pitch))
    incrementCount(wrongNoteCountsRef.current, playedPitch)

    const expected = expectedPitchesForEvent.map(midiToNoteName).join(', ')
    const played = midiToNoteName(playedPitch)
    const key = expected + ' -> ' + played
    const existing = confusionCountsRef.current.get(key)
    confusionCountsRef.current.set(key, { expected, played, count: (existing?.count ?? 0) + 1 })
  }

  const recordNoteResponse = () => {
    responseTimesRef.current.push(Math.max(0, nowMs() - eventStartedAtRef.current))
  }

  const buildNoteStats = (): ExerciseSessionStats =>
    summarizeExerciseStats(
      responseTimesRef.current,
      missedNoteCountsRef.current,
      wrongNoteCountsRef.current,
      confusionCountsRef.current,
    )

  /**
   * A snapshot of the session as it stands right now. Written repeatedly (start,
   * heartbeat, end) under one stable id, so the log always holds the session's
   * latest known state rather than only its final one.
   */
  const buildSessionRecord = (completed: boolean): PracticeSessionRecord => {
    const endedAt = Date.now()
    const eventsPlayed = waitEngineRef.current?.state.currentIndex ?? 0
    const reached = completed ? totalEventsRef.current : eventsPlayed
    return {
      id: sessionIdRef.current,
      startedAt: sessionStartedAtRef.current,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - Date.parse(sessionStartedAtRef.current),
      completed,
      practiceMode: practiceModeRef.current,
      // What was actually required, not what the selector says: on a score
      // without two hands, 'right' still plays every note, and the catalog's
      // progress counts a one-hand session for half the piece.
      handMode: osmdRef.current ? effectiveHandMode(osmdRef.current, handModeRef.current) : handModeRef.current,
      source: sessionSourceRef.current,
      totalEvents: totalEventsRef.current,
      eventsPlayed,
      // Deliberately not max'd with eventsPlayed: that one is the cursor's
      // position, which a jump moves without a note ever being played. Looking
      // at the last page is not progress through the piece.
      furthestEventIndex: furthestIndexRef.current,
      errorCount: errorCountRef.current,
      correctNoteCount: correctNoteCountRef.current,
      // Over the events actually reached, so an abandoned session reports the
      // accuracy of what was played instead of being punished for the rest.
      successPercent: reached === 0 ? 0 : Math.round((100 * (reached - eventsWithErrorsRef.current.size)) / reached),
      maxCombo: maxComboRef.current,
      notes: buildNoteStats(),
    }
  }

  const persistSession = (completed: boolean) => {
    // A guest is looking at the owner's history, not building one: recording
    // their play would mix into what the stats screen shows them (the server
    // refuses their sync anyway, so it could never reach anyone else).
    if (isGuest()) {
      return
    }
    // Once a session is on record as completed, no later snapshot may downgrade
    // it -- the heartbeat and the unmount that follows the End screen both still
    // run after finishSession.
    if (sessionCompletedRef.current) {
      return
    }
    sessionCompletedRef.current = completed
    saveSession(buildSessionRecord(completed))
  }

  // Settles the display back to neutral after `delayMs` with no further
  // input: a partly played chord expires once the chord tolerance has passed
  // (not just visually: the engine drops the held notes too), and a wrong key
  // stops being red after WRONG_NOTE_DISPLAY_MS. A wrong keypress within the
  // chord tolerance window is reported but doesn't erase already-held correct
  // notes (see WaitEngine.noteOn).
  const scheduleDecay = (delayMs: number) => {
    clearDecayTimer()
    decayTimeoutRef.current = setTimeout(() => {
      const engine = waitEngineRef.current
      if (engine) {
        engine.expireStaleHold(performance.now())
        scoreRef.current?.syncNotes(engine.currentHeldPitches)
        setHeldPitches(engine.currentHeldPitches)
        setWrongPitches([])
      }
      decayTimeoutRef.current = null
    }, delayMs)
  }

  useEffect(() => {
    return () => {
      clearDecayTimer()
      cancelLongPress()
      if (sectionMessageTimeoutRef.current !== null) {
        clearTimeout(sectionMessageTimeoutRef.current)
      }
      synthRef.current?.stop()
    }
  }, [])

  // "Hear the tune" preview, unrelated to Wait Mode's gating: plays the hand(s)
  // selected by hand mode over the range practice is confined to -- the loop,
  // else the whole piece -- via a plain Web Audio synth,
  // independent of the live practice cursor. See extractTimedNotes for why it
  // walks its own OSMD iterator instead of the shared osmd.cursor.
  const handleTogglePreviewPlayback = () => {
    if (!synthRef.current) {
      synthRef.current = new ScoreSynth()
    }
    const synth = synthRef.current
    if (isPreviewPlaying) {
      synth.stop()
      setIsPreviewPlaying(false)
      return
    }
    const osmd = osmdRef.current
    if (!osmd) {
      return
    }
    synth.play(extractTimedNotes(osmd, activeBounds, handModeRef.current), () => setIsPreviewPlaying(false))
    setIsPreviewPlaying(true)
  }

  // The session's whole lifecycle in the log: recorded as soon as practice
  // starts (so quitting early still counts as practice, and as a practice day
  // for the streak), refreshed while it runs, and refreshed once more on the way
  // out. A tab killed outright runs none of this, which is exactly why the
  // heartbeat exists -- the record left behind is then only as stale as the last
  // beat, instead of claiming a zero-length session.
  useEffect(() => {
    persistSession(false)
    const heartbeat = setInterval(() => persistSession(false), SESSION_HEARTBEAT_MS)
    return () => {
      clearInterval(heartbeat)
      persistSession(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Moves practice to an event. `bounds` also sets the crop in the same step
   * (null = the whole piece); omitted, the crop already drawn is kept. Every
   * range change goes through `bounds` rather than cropping separately: the
   * walk has to run uncropped (see setSectionBounds' note in PianoScore), and
   * doing it in one call is what lets that cost no render of its own.
   */
  const goToEventIndex = (targetIndex: number, bounds?: Section | null) => {
    const engine = waitEngineRef.current
    if (!engine) {
      return
    }
    clearDecayTimer()
    engine.jumpToEventIndex(targetIndex)
    scoreRef.current?.goToEventIndex(
      targetIndex,
      bounds === undefined ? undefined : bounds && { startMeasure: bounds.startMeasure, endMeasure: bounds.endMeasure },
    )
    previousIndexRef.current = engine.state.currentIndex
    currentEventErredRef.current = false
    // Any move of the cursor (retry, back to start, a jump, a mode or hand
    // switch) is a way out of a frozen sudden-death miss.
    setMiss(null)
    // Only the in-progress streak resets on a jump -- the session's best
    // combo (maxComboRef) is a record, not live progress, so it survives.
    comboRef.current = 0
    setCurrentCombo(0)
    setEngineState(engine.state)
    setCurrentMeasure(scoreRef.current?.getCurrentMeasure() ?? 1)
    setWrongNoteFeedback(null)
    setExpectedPitches(engine.currentExpectedPitches)
    setExpectedHandPitches(handPitchesOf(engine.currentEvent))
    setHeldPitches([])
    setWrongPitches([])
    eventStartedAtRef.current = nowMs()
  }

  // The WaitEngine reached its last event: the piece is done.
  const finishSession = () => {
    const total = totalEventsRef.current
    persistSession(true)
    const stats: SessionStats = {
      durationMs: Date.now() - startedAtRef.current,
      errorCount: errorCountRef.current,
      totalEvents: total,
      successPercent: Math.round((100 * (total - eventsWithErrorsRef.current.size)) / total),
      maxCombo: maxComboRef.current,
      // The End screen's response-time breakdown stays exercise-only: on a real
      // score those timings are mostly sight-reading pauses, not reaction times.
      ...(sourceKindRef.current === 'generated-training' ? { exercise: buildNoteStats() } : {}),
    }
    onComplete(stats)
  }

  // Scroll loop never advances and never ends: reaching the last measure
  // of the loop starts it again, clean pass or not. The loop's crop is already
  // the one drawn, so this costs no render at all.
  const restartLoop = (loop: Section, message: string | null = null) => {
    goToEventIndex(loop.startEventIndex, loop)
    if (message !== null) {
      showSectionMessage(message)
    }
  }

  // Any move of either bound puts the cursor back on the loop's first measure,
  // deliberately: after changing what is being drilled, the only position that
  // is never surprising is the start of it.
  const handleLoopRangeChange = (start: number, end: number) => {
    runWhileBusy('Moving...', () => changeLoopRange(start, end))
  }

  const changeLoopRange = (start: number, end: number) => {
    const clampedStart = Math.min(Math.max(1, Math.round(start)), Math.max(1, totalMeasures))
    const clampedEnd = Math.min(Math.max(clampedStart, Math.round(end)), Math.max(1, totalMeasures))
    setLoopRange({ start: clampedStart, end: clampedEnd })
    setSectionMessage(null)
    // The loopSection memo has not recomputed at this point, so the bounds to
    // apply are derived here.
    const bounds =
      clampedStart <= 1 && clampedEnd >= totalMeasures ? null : sectionForMeasureRange(events, clampedStart, clampedEnd)
    goToEventIndex(bounds ? bounds.startEventIndex : eventIndexAtOrAfterMeasure(events, clampedStart), bounds)
  }

  useEffect(() => {
    const handleNoteEvent = (event: MidiNoteEvent) => {
      // A note landing between a switch and its work would be judged against
      // the event list the switch is about to replace.
      if (event.type !== 'noteon' || busyRef.current || suddenDeathMissRef.current !== null) {
        return
      }
      // Page free is a plain read-along viewer with no wait-gating and no
      // cursor -- correctness is never checked, so nothing gets colored and
      // no wrong/missed-note stats are collected. A note was genuinely played
      // though, and still has to be counted as such (not just detected) --
      // isCountedSession only keeps a session that has correctNoteCount or
      // errorCount above zero, and this mode never touches errorCount.
      if (practiceModeRef.current === 'page') {
        correctNoteCountRef.current += 1
        setCorrectNoteCount(correctNoteCountRef.current)
        return
      }
      const engine = waitEngineRef.current
      if (!engine) {
        return
      }
      const indexBeforeNote = engine.state.currentIndex
      const expectedPitchesBeforeNote = engine.currentExpectedPitches
      const status = engine.noteOn(event.pitch, event.timestamp)

      const activeSection = activeBoundsRef.current

      if (status === 'error') {
        eventsWithErrorsRef.current.add(indexBeforeNote)
        errorCountRef.current += 1
        setErrorCount(errorCountRef.current)
        const brokenRun = comboRef.current
        comboRef.current = 0
        setCurrentCombo(0)
        if (brokenRun > 0) {
          setComboBreak({ id: Date.now(), value: brokenRun })
        }
        currentEventErredRef.current = true
        recordNoteError(expectedPitchesBeforeNote, event.pitch)
        scoreRef.current?.syncNotes(engine.currentHeldPitches)
        setWrongPitches((pitches) => [...pitches, event.pitch])
        // Sudden death: the run is over, but nothing moves yet. Practice
        // freezes on the missed event, the wrong key stays red (no decay) and
        // the card offers a retry from the first note. A miss on the very
        // first note has nothing to start over from, so it is a plain error.
        if (practiceModeRef.current === 'suddenDeath' && indexBeforeNote > 0) {
          clearDecayTimer()
          setMiss({
            measure: scoreRef.current?.getCurrentMeasure() ?? 1,
            expected: expectedPitchesBeforeNote.map(midiToNoteName).join(' + '),
            played: midiToNoteName(event.pitch),
            run: brokenRun,
          })
        } else {
          scheduleDecay(WRONG_NOTE_DISPLAY_MS)
          // The card says the same thing on a sudden-death miss, so only here.
          const expectedNames = expectedPitchesBeforeNote.map(midiToNoteName).join(', ')
          setWrongNoteFeedback(`Expected ${expectedNames} -- you played ${midiToNoteName(event.pitch)}`)
        }
      } else {
        setWrongNoteFeedback(null)
        // Every correct keypress counts, whether it's a single note, one hit
        // of a multi-note chord, or the note that finally completes an event.
        correctNoteCountRef.current += 1
        setCorrectNoteCount(correctNoteCountRef.current)
        const newIndex = engine.state.currentIndex
        if (newIndex > previousIndexRef.current) {
          recordNoteResponse()
          clearDecayTimer()
          setWrongPitches([])
          if (!currentEventErredRef.current) {
            comboRef.current += 1
            maxComboRef.current = Math.max(maxComboRef.current, comboRef.current)
            setCurrentCombo(comboRef.current)
            setBestCombo(maxComboRef.current)
          }
          scoreRef.current?.next()
          setCurrentMeasure(scoreRef.current?.getCurrentMeasure() ?? 1)
          previousIndexRef.current = newIndex
          currentEventErredRef.current = false
          furthestIndexRef.current = Math.max(furthestIndexRef.current, newIndex)

          if (activeSection && newIndex >= activeSection.endEventIndex) {
            restartLoop(activeSection)
          } else if (engine.state.completed) {
            finishSession()
          } else {
            eventStartedAtRef.current = nowMs()
          }
        } else {
          scoreRef.current?.syncNotes(engine.currentHeldPitches)
          // A partly played chord: expire it once the tolerance has passed.
          scheduleDecay(DEFAULT_CHORD_TOLERANCE_MS + 20)
        }
      }
      setEngineState(engine.state)
      setExpectedPitches(engine.currentExpectedPitches)
      setExpectedHandPitches(handPitchesOf(engine.currentEvent))
      setHeldPitches(engine.currentHeldPitches)
    }
    const unsubscribe = onNoteEvent(handleNoteEvent)
    if (!import.meta.env.DEV) {
      return unsubscribe
    }
    // Development only (import.meta.env.DEV, compiled away in production):
    // plays without a MIDI keyboard by feeding the same handler a real note
    // would reach.
    // `o` plays every expected note not already held (a whole chord at once,
    // within the chord tolerance), `k` plays one note that is not expected.
    const handleDebugKey = (keyEvent: KeyboardEvent) => {
      const target = keyEvent.target as HTMLElement | null
      if (
        keyEvent.repeat ||
        keyEvent.ctrlKey ||
        keyEvent.metaKey ||
        keyEvent.altKey ||
        (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      ) {
        return
      }
      const key = keyEvent.key.toLowerCase()
      if (key !== 'o' && key !== 'k') {
        return
      }
      const engine = waitEngineRef.current
      const expected = engine?.currentExpectedPitches ?? []
      const held = engine?.currentHeldPitches ?? []
      let pitches: number[]
      if (key === 'o') {
        pitches = expected.filter((pitch) => !held.includes(pitch))
      } else {
        let wrong = (expected[0] ?? 60) + 1
        while (expected.includes(wrong)) {
          wrong += 1
        }
        pitches = [wrong]
      }
      const timestamp = performance.now()
      pitches.forEach((pitch) => handleNoteEvent({ pitch, velocity: 100, timestamp, type: 'noteon' }))
    }
    window.addEventListener('keydown', handleDebugKey)
    return () => {
      unsubscribe()
      window.removeEventListener('keydown', handleDebugKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNoteEvent, onComplete])

  const handleReady = (osmd: OpenSheetMusicDisplay) => {
    clearDecayTimer()
    // A remount (layout/hand-mode switch, or moving to a new exercise) can
    // load a different file entirely -- any in-progress preview is now
    // playing back notes that no longer match what's on screen.
    synthRef.current?.stop()
    setIsPreviewPlaying(false)
    osmdRef.current = osmd
    const newEvents = extractExpectedEvents(osmd, handMode)
    totalEventsRef.current = newEvents.length
    setTotalEvents(newEvents.length)
    setEvents(newEvents)
    // A remount reloads the piece from the top, so the loop goes back to
    // covering all of it (which applies no crop, matching the branch below).
    setLoopRange({ start: 1, end: Math.max(1, lastMeasureNumber(newEvents)) })
    scoreRef.current?.setSectionBounds(null, null)
    waitEngineRef.current = new WaitEngine(newEvents)
    previousIndexRef.current = 0
    currentEventErredRef.current = false
    setMiss(null)
    furthestIndexRef.current = 0
    eventsWithErrorsRef.current = new Set()
    errorCountRef.current = 0
    comboRef.current = 0
    maxComboRef.current = 0
    correctNoteCountRef.current = 0
    resetNoteStats()
    setCurrentCombo(0)
    setBestCombo(0)
    setCorrectNoteCount(0)
    setSectionMessage(null)
    startedAtRef.current = Date.now()
    setWrongNoteFeedback(null)
    setEngineState(waitEngineRef.current.state)
    // A remount starts over, but nothing else resets the header's measure, so
    // it kept showing wherever the previous layout had been.
    setCurrentMeasure(scoreRef.current?.getCurrentMeasure() ?? 1)
    // Page free never highlights anything -- see isFreePageMode.
    setExpectedPitches(practiceMode === 'page' ? [] : waitEngineRef.current.currentExpectedPitches)
    setExpectedHandPitches(practiceMode === 'page' ? NO_HAND_PITCHES : handPitchesOf(waitEngineRef.current.currentEvent))
    setHeldPitches([])
    setWrongPitches([])
    const allPitches = newEvents.flatMap((event) => event.pitches)
    if (allPitches.length > 0) {
      setPitchRange({ low: Math.min(...allPitches), high: Math.max(...allPitches) })
    }
    if (practiceMode !== 'page') {
      scoreRef.current?.syncNotes([])
    }
    // The first load, and every remount a page <-> scroll switch left waiting.
    endBusy()
  }

  const handleLoadError = (message: string) => {
    endBusy()
    setLoadError(message)
  }

  const handleZoomChange = (value: number) => {
    setZoomValue(value)
    scoreRef.current?.setZoom(value)
  }

  // Sudden death's way out of a miss: the whole piece again from its first
  // note. No overlay: with nothing cropped, the jump renders nothing.
  const handleRetry = () => {
    goToEventIndex(0)
  }

  // Enter or Space retries too, so a desktop player need not reach for the
  // mouse. Only while a miss is shown, and never while typing in a field.
  useEffect(() => {
    if (suddenDeathMiss === null) {
      return
    }
    const handleKey = (keyEvent: KeyboardEvent) => {
      const target = keyEvent.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
        return
      }
      if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
        keyEvent.preventDefault()
        goToEventIndex(0)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suddenDeathMiss])

  // In Scroll loop this is "back to the top of the loop", which is the one
  // control that mode needs constantly; everywhere else it is the top of the
  // piece. Silent on purpose: the player asked for it, so it needs no message.
  const handleBackToStart = () => {
    runWhileBusy('Moving...', () => {
      const loop = activeBounds
      if (isLoopMode && loop) {
        restartLoop(loop)
        return
      }
      goToEventIndex(0)
    })
  }

  // Every measure-addressed cursor jump goes through here -- desktop's "Go to
  // measure" box and mobile's long press on the staff -- so the two can never
  // disagree about what a jump means. Returns whether a jump actually
  // happened, so a caller can skip its own feedback for a measure that holds
  // no playable event.
  const jumpToMeasure = (measureNumber: number): boolean => {
    const engine = waitEngineRef.current
    if (!engine || !Number.isFinite(measureNumber) || measureNumber < 1) {
      return false
    }
    const eventIndex = engine.findEventIndexForMeasure(measureNumber)
    if (eventIndex === null) {
      return false
    }
    // Scroll loop's range is the drawn range, and only measures inside it
    // exist on screen: a jump outside would leave the cursor on measures that
    // are not rendered. Refused with a message rather than silently ignored,
    // and rather than moving the loop the player just placed.
    if (isLoopMode) {
      const loop = activeBounds
      if (loop && (measureNumber < loop.startMeasure || measureNumber > loop.endMeasure)) {
        showSectionMessage(`Measure ${measureNumber} is outside the loop (${loop.startMeasure}-${loop.endMeasure})`)
        return false
      }
      goToEventIndex(eventIndex, loop)
      return true
    }
    goToEventIndex(eventIndex)
    return true
  }

  const handleJumpToMeasure = () => {
    jumpToMeasure(Number(measureInputValue))
  }

  const cancelLongPress = () => {
    if (longPressTimeoutRef.current !== null) {
      clearTimeout(longPressTimeoutRef.current)
      longPressTimeoutRef.current = null
    }
    longPressStartRef.current = null
  }

  // Mobile's replacement for the desktop "Go to measure" box, which has no
  // room in the one-row phone header: press and hold anywhere on the score and
  // the cursor moves to the measure under the finger. Page free is excluded --
  // it has no cursor at all (see isFreePageMode).
  const handleScoreTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    cancelLongPress()
    if (isFreePageMode || event.touches.length !== 1) {
      return
    }
    // Read off the touch now, not inside the timeout: the position is what
    // was pressed, and by the time it fires the touch list is gone.
    const { clientX, clientY } = event.touches[0]
    longPressStartRef.current = { x: clientX, y: clientY }
    longPressTimeoutRef.current = setTimeout(() => {
      longPressTimeoutRef.current = null
      longPressStartRef.current = null
      const measureNumber = scoreRef.current?.measureAtClientPoint(clientX, clientY) ?? null
      if (measureNumber === null || !jumpToMeasure(measureNumber)) {
        return
      }
      // Production is plain HTTP, so treat every extra navigator API as
      // possibly absent rather than trusting a localhost run -- same guard
      // useWakeLock makes for the same reason.
      if ('vibrate' in navigator) {
        navigator.vibrate(20)
      }
      showSectionMessage(`Moved to measure ${measureNumber}`)
    }, LONG_PRESS_MS)
  }

  const handleScoreTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = longPressStartRef.current
    if (!start) {
      return
    }
    const touch = event.touches[0]
    if (
      !touch ||
      Math.abs(touch.clientX - start.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
      Math.abs(touch.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    ) {
      cancelLongPress()
    }
  }

  const handleSelectPracticeMode = (newMode: PracticeMode) => {
    if (newMode === practiceMode || busyRef.current) {
      return
    }
    setPendingSelection({ mode: newMode })
    // Page is the one layout of its own: leaving or entering it remounts OSMD.
    const remounts = (newMode === 'page') !== (practiceMode === 'page')
    runWhileBusy(remounts ? 'Laying out the score...' : 'Switching mode...', () => {
      selectPracticeMode(newMode, remounts)
      return remounts ? WAIT_FOR_READY : undefined
    })
  }

  const selectPracticeMode = (newMode: PracticeMode, remounts: boolean) => {
    const wasCropped = activeBounds !== null
    setPracticeMode(newMode)
    setSectionMessage(null)
    if (remounts) {
      // The new layout gets a new OSMD instance, and handleReady starts it over
      // from the top with the new mode's crop. Moving the cursor or the crop
      // here would be a full render of the instance about to be thrown away
      // (it was 1.7s of a 4s section -> page switch on a throttled phone).
      if (newMode === 'scrollLoop') {
        setLoopRange({ start: 1, end: Math.max(1, totalMeasures) })
      }
      return
    }

    if (newMode === 'scrollLoop') {
      // A fresh loop is always the whole piece, so entering the mode changes
      // nothing on screen until a bound is moved. Whatever crop the previous
      // mode had applied still has to go, and un-cropping needs its own walk.
      setLoopRange({ start: 1, end: Math.max(1, totalMeasures) })
      if (wasCropped) {
        goToEventIndex(waitEngineRef.current?.state.currentIndex ?? 0, null)
      }
    } else if (newMode === 'suddenDeath') {
      // A run only means something from the first note, so entering the mode
      // starts the piece over (uncropping a loop on the way, in the same walk).
      goToEventIndex(0, wasCropped ? null : undefined)
    } else if (wasCropped) {
      // Leaving a cropped loop: uncrop and walk in one call -- the cursor walk
      // must always happen with no crop active (OSMD's own tie/rest counting
      // only lines up with WaitEngine's indices on the fully uncropped model,
      // see setSectionBounds in PianoScore). cursor.show()
      // alone doesn't reliably relocate onto the freshly-uncropped, much
      // larger graphical model either, so a fresh walk is required even
      // though the logical index isn't changing.
      goToEventIndex(waitEngineRef.current?.state.currentIndex ?? 0, null)
    }
    // else: page <-> scroll with nothing cropped, nothing to move.
  }

  // Live hand-mode switch: which notes are required changes, which changes
  // how many cursor positions count as a real event (a step where only the
  // deselected hand plays is no longer required at all) -- so the event
  // count/indices can shift, and the safest thing is to recompute events and
  // restart from the top of the loop (or of the piece), same trade-off already made for a layoutMode remount.
  const handleSelectHandMode = (newHandMode: HandMode) => {
    if (newHandMode === handMode || busyRef.current) {
      return
    }
    setPendingSelection({ hand: newHandMode })
    runWhileBusy('Switching hands...', () => selectHandMode(newHandMode))
  }

  const selectHandMode = (newHandMode: HandMode) => {
    const osmd = osmdRef.current
    if (!osmd) {
      return
    }
    setHandMode(newHandMode)
    // Synchronous ref write inside PianoScore -- must happen before the
    // goToEventIndex() calls below, which run in this same tick, well before
    // React re-renders PianoScore with the new handMode prop.
    scoreRef.current?.setHandMode(newHandMode)
    clearDecayTimer()
    // Walks the whole piece even under a crop (withUncroppedCursor), so the
    // fresh event list covers the piece rather than the drawn range, with no
    // render to clear the crop first.
    const newEvents = extractExpectedEvents(osmd, newHandMode)
    totalEventsRef.current = newEvents.length
    setTotalEvents(newEvents.length)
    setEvents(newEvents)
    waitEngineRef.current = new WaitEngine(newEvents)
    // A different hand mode is a different event list, so an index from the old
    // one is not comparable and must not carry over as progress.
    furthestIndexRef.current = 0
    eventsWithErrorsRef.current = new Set()
    errorCountRef.current = 0
    setErrorCount(0)
    comboRef.current = 0
    maxComboRef.current = 0
    setBestCombo(0)
    correctNoteCountRef.current = 0
    setCorrectNoteCount(0)
    resetNoteStats()
    setSectionMessage(null)

    if (isLoopMode) {
      // The loop is in measure space, so it survives the renumbering; it only
      // needs re-clamping in case the other hand reached further into the piece.
      const freshTotal = Math.max(1, lastMeasureNumber(newEvents))
      const start = Math.min(loopRange.start, freshTotal)
      const end = Math.min(Math.max(loopRange.end, start), freshTotal)
      setLoopRange({ start, end })
      const bounds = start <= 1 && end >= freshTotal ? null : sectionForMeasureRange(newEvents, start, end)
      goToEventIndex(bounds ? bounds.startEventIndex : 0, bounds)
    } else {
      goToEventIndex(0)
    }

    const allPitches = newEvents.flatMap((event) => event.pitches)
    if (allPitches.length > 0) {
      setPitchRange({ low: Math.min(...allPitches), high: Math.max(...allPitches) })
    }
    scoreRef.current?.syncNotes([])
  }

  if (loadError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="text-red-600">{loadError}</p>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Back to home
        </button>
      </div>
    )
  }

  const displayedIndex = Math.min((engineState?.currentIndex ?? 0) + 1, totalEvents)
  const showGeneratedAssistKeyboard =
    sourceKind === 'generated-training' &&
    (keyboardAssistMode === 'learning' || (keyboardAssistMode === 'mistakes-only' && wrongPitches.length > 0))
  const showMobileKeyboard = sourceKind !== 'generated-training' ? mobileKeyboardVisible : showGeneratedAssistKeyboard
  const showDesktopKeyboard = sourceKind === 'generated-training' ? showGeneratedAssistKeyboard : showKeyboard
  const keyboardAssistLabel =
    keyboardAssistMode === 'none' ? 'No help' : keyboardAssistMode === 'mistakes-only' ? 'Mistakes only' : 'Learning'
  const backingTrackLabel = backingTrack ? 'Beat: ' + backingTrack.keyName : 'Beat'
  const backingTrackButtonLabel = backing.isRunning ? backingTrackLabel : 'Start audio'
  const compactKeySignatureLabel = keySignature
    ? `${keySignature.keyName} · ${
        keySignature.accidentalsLabel === 'No sharps or flats'
          ? 'no ♯/♭'
          : keySignature.accidentalsLabel.replace(/^(Sharps|Flats): /, '')
      }`
    : null
  const handleBackingTrackButton = () => {
    if (backing.isRunning) {
      backing.stop()
    } else {
      void backing.start()
    }
  }

  // Mobile gets a single compact icon-button header (name, home, back to
  // start) with every other row -- HUD, the desktop
  // controls, the training panel, banners -- omitted
  // entirely so the score gets the whole rest of a landscape phone screen.
  // The combo is drawn over the score itself (ComboOverlay).
  if (isMobile) {
    return (
      // h-dvh, not h-screen: 100vh is the viewport with the browser's address
      // bar hidden, so while it shows, a phone or tablet scrolled the screen by
      // its height and the score's top (the combo) and the keyboard at the
      // bottom could not both be in view.
      <div className="flex h-dvh w-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to home"
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
          >
            <HomeIcon className="h-5 w-5" />
          </button>
          {onBackToCatalog && (
            <button
              type="button"
              onClick={onBackToCatalog}
              aria-label="Back to catalog"
              className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
            >
              <LibraryIcon className="h-5 w-5" />
            </button>
          )}
          {sourceKind === 'generated-training' && onExerciseSettings && (
            <button
              type="button"
              onClick={onExerciseSettings}
              aria-label="Exercise settings"
              className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
            >
              <SettingsIcon className="h-5 w-5" />
            </button>
          )}
          <h1
            className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-gray-900"
            title={keySignature ? `${keySignature.keyName} · ${keySignature.accidentalsLabel}` : scoreFile.name}
          >
            {compactKeySignatureLabel ?? scoreFile.name}
          </h1>
          {backing.isEnabled && (
            <button
              type="button"
              onClick={handleBackingTrackButton}
              className={
                backing.isRunning
                  ? 'rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700'
                  : 'rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white'
              }
            >
              {backingTrackButtonLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleTogglePreviewPlayback}
            aria-label={isPreviewPlaying ? 'Stop playback' : 'Play score'}
            className={
              isPreviewPlaying ? 'rounded-md p-2 text-red-600 hover:bg-red-50' : 'rounded-md p-2 text-gray-600 hover:bg-gray-100'
            }
          >
            {isPreviewPlaying ? <StopIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
          </button>
          <select
            value={pendingSelection.mode ?? practiceMode}
            onChange={(e) => handleSelectPracticeMode(e.target.value as PracticeMode)}
            aria-label="Practice mode"
            className="w-20 shrink-0 rounded-md border border-gray-300 bg-white px-1 py-1.5 text-xs"
          >
            <option value="page">Page</option>
            <option value="scroll">Scroll</option>
            <option value="scrollLoop">Loop</option>
            <option value="suddenDeath">S. death</option>
          </select>
          <select
            value={pendingSelection.hand ?? handMode}
            onChange={(e) => handleSelectHandMode(e.target.value as HandMode)}
            aria-label="Hand"
            className="w-16 shrink-0 rounded-md border border-gray-300 bg-white px-1 py-1.5 text-xs"
          >
            <option value="both">2 hands</option>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
          {sourceKind !== 'generated-training' && (
            <button
              type="button"
              onClick={() => setMobileKeyboardVisible((value) => !value)}
              aria-label={mobileKeyboardVisible ? 'Hide keyboard' : 'Show keyboard'}
              className={
                mobileKeyboardVisible
                  ? 'rounded-md bg-gray-900 p-2 text-white'
                  : 'rounded-md p-2 text-gray-600 hover:bg-gray-100'
              }
            >
              <KeyboardIcon className="h-5 w-5" />
            </button>
          )}
          {!isFreePageMode && (
            <button
              type="button"
              onClick={handleBackToStart}
              aria-label="Back to start"
              className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
            >
              <SkipToStartIcon className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Scroll loop only, and deliberately one thin row: every pixel
            spent here is a pixel the score loses on a landscape phone, so
            there are no tick numbers, no numeric fields and no stepper
            buttons on mobile. A and B cover setting the loop while playing,
            and the two handles cover widening it, since the bar always spans
            the whole piece even when the score is cropped to the loop. */}
        {isLoopMode && totalMeasures > 0 && (
          <div className="shrink-0 border-b border-gray-200 bg-white">
            <LoopRangeBar
              compact
              totalMeasures={totalMeasures}
              startMeasure={loopRange.start}
              endMeasure={loopRange.end}
              currentMeasure={currentMeasure}
              onChange={handleLoopRangeChange}
            />
          </div>
        )}

        {/* Long-press-to-move-the-cursor target (see handleScoreTouchStart).
            The wrapper is what carries the touch handlers rather than
            PianoScore itself, so the score component stays free of gesture
            handling; select-none plus the callout/context-menu suppression
            below keep Android from opening its own text-selection popup on
            top of the press. */}
        <div
          className="relative flex min-h-0 flex-1 select-none flex-col"
          style={{ WebkitTouchCallout: 'none' }}
          onTouchStart={handleScoreTouchStart}
          onTouchMove={handleScoreTouchMove}
          onTouchEnd={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onContextMenu={(event) => event.preventDefault()}
        >
          <PianoScore
            ref={scoreRef}
            source={scoreFile}
            layoutMode={resolvedLayoutMode}
            handMode={handMode}
            onReady={handleReady}
            onError={handleLoadError}
          />
          {!isFreePageMode && (
            <ComboOverlay compact combo={currentCombo} best={bestCombo} comboBreak={comboBreak} />
          )}
          {suddenDeathMiss && (
            <SuddenDeathCard compact miss={suddenDeathMiss} best={bestCombo} onRetry={handleRetry} />
          )}
          {busyLabel && <ScoreBusyOverlay label={busyLabel} />}
          {/* Transient messages (loop restarts, long-press jumps), floated
              over the score rather than given a row of its own: a landscape phone has no vertical
              room to spare, and the message is transient either way. */}
          {sectionMessage && (
            <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-indigo-600/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
              {sectionMessage}
            </p>
          )}
        </div>

        {/* Regular scores default to on, toggled via the header keyboard icon.
            Generated exercises instead follow the setup assistance mode: hidden,
            visible only after mistakes, or always visible for learning. */}
        {showMobileKeyboard && (
          <div className="shrink-0 border-t border-gray-200 bg-white p-1.5">
            <VirtualKeyboard
              lowestPitch={pitchRange.low}
              highestPitch={pitchRange.high}
              expectedPitches={expectedPitches}
              heldPitches={heldPitches}
              wrongPitches={wrongPitches}
              rightHandPitches={expectedHandPitches.right}
              leftHandPitches={expectedHandPitches.left}
              fingerByPitch={expectedHandPitches.fingerByPitch}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    // h-dvh for the same reason as the mobile layout: a tablet gets this one.
    <div className="mx-auto flex h-dvh w-full max-w-[1600px] flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-gray-900">{scoreFile.name}</h1>
        <div className="flex shrink-0 items-center gap-3">
          {sourceKind === 'generated-training' && onExerciseSettings && (
            <button type="button" onClick={onExerciseSettings} className="text-sm text-gray-500 hover:underline">
              Settings
            </button>
          )}
          {onBackToCatalog && (
            <button type="button" onClick={onBackToCatalog} className="text-sm text-gray-500 hover:underline">
              Back to catalog
            </button>
          )}
          <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline">
            Home
          </button>
        </div>
      </div>

      {keySignature && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">{keySignature.keyName}</span>
          <span className="mx-2" aria-hidden="true">·</span>
          {keySignature.accidentalsLabel}
        </div>
      )}

      <ScoreHud
        bestCombo={bestCombo}
        correctNoteCount={correctNoteCount}
        errorCount={errorCount}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
        {!isFreePageMode && (
          <>
            <span>
              Measure {currentMeasure} -- Event {displayedIndex} / {totalEvents}
            </span>
            <button
              type="button"
              onClick={handleBackToStart}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50"
            >
              Back to start
            </button>
            <label className="flex items-center gap-2">
              Go to measure
              <input
                type="number"
                min={1}
                value={measureInputValue}
                onChange={(e) => setMeasureInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleJumpToMeasure()
                  }
                }}
                className="w-16 rounded-md border border-gray-300 bg-white px-2 py-1"
              />
              <button
                type="button"
                onClick={handleJumpToMeasure}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50"
              >
                Go
              </button>
            </label>
          </>
        )}
        <label className="flex items-center gap-2">
          Zoom
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          onClick={handleTogglePreviewPlayback}
          className={
            isPreviewPlaying
              ? 'flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-sm text-red-700 hover:bg-red-100'
              : 'flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50'
          }
        >
          {isPreviewPlaying ? <StopIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          {isPreviewPlaying ? 'Stop' : 'Play'}
        </button>
        {sourceKind === 'generated-training' ? (
          <>
            <span className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm text-gray-600">
              Keyboard help: {keyboardAssistLabel}
            </span>
            {backing.isEnabled && (
              <button
                type="button"
                onClick={handleBackingTrackButton}
                className={
                  backing.isRunning
                    ? 'rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm text-emerald-700'
                    : 'rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50'
                }
              >
                {backingTrackButtonLabel}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowKeyboard((value) => !value)}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50"
          >
            {showKeyboard ? 'Hide keyboard' : 'Show keyboard'}
          </button>
        )}
        <label className="flex items-center gap-2">
          Mode
          <select
            value={pendingSelection.mode ?? practiceMode}
            onChange={(e) => handleSelectPracticeMode(e.target.value as PracticeMode)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1"
          >
            <option value="page">Page free</option>
            <option value="scroll">Scroll free</option>
            <option value="scrollLoop">Scroll loop</option>
            <option value="suddenDeath">Sudden death</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Hand
          <select
            value={pendingSelection.hand ?? handMode}
            onChange={(e) => handleSelectHandMode(e.target.value as HandMode)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1"
          >
            <option value="both">Both hands</option>
            <option value="right">Right hand</option>
            <option value="left">Left hand</option>
          </select>
        </label>
      </div>

      {sectionMessage && <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700">{sectionMessage}</p>}

      {wrongNoteFeedback && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{wrongNoteFeedback}</p>}

      {isLoopMode && totalMeasures > 0 && (
        <LoopRangeBar
          totalMeasures={totalMeasures}
          startMeasure={loopRange.start}
          endMeasure={loopRange.end}
          currentMeasure={currentMeasure}
          onChange={handleLoopRangeChange}
        />
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <PianoScore
          ref={scoreRef}
          source={scoreFile}
          layoutMode={resolvedLayoutMode}
          handMode={handMode}
          onReady={handleReady}
          onError={handleLoadError}
        />
        {!isFreePageMode && <ComboOverlay combo={currentCombo} best={bestCombo} comboBreak={comboBreak} />}
        {suddenDeathMiss && <SuddenDeathCard miss={suddenDeathMiss} best={bestCombo} onRetry={handleRetry} />}
        {busyLabel && <ScoreBusyOverlay label={busyLabel} />}
      </div>

      {showDesktopKeyboard && (
        <VirtualKeyboard
          lowestPitch={pitchRange.low}
          highestPitch={pitchRange.high}
          expectedPitches={expectedPitches}
          heldPitches={heldPitches}
          wrongPitches={wrongPitches}
          rightHandPitches={expectedHandPitches.right}
          leftHandPitches={expectedHandPitches.left}
          fingerByPitch={expectedHandPitches.fingerByPitch}
        />
      )}
    </div>
  )
}
