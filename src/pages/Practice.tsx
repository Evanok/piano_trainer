import { useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HomeIcon,
  KeyboardIcon,
  LibraryIcon,
  PlayIcon,
  SettingsIcon,
  SkipToStartIcon,
  StopIcon,
} from '../components/icons'
import { PianoScore, type LayoutMode, type PianoScoreHandle } from '../components/PianoScore'
import { ScoreHud } from '../components/ScoreHud'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { extractExpectedEvents, extractNaturalBreakMeasures } from '../engine/ScoreParser'
import { extractTimedNotes } from '../engine/scorePlayback'
import { ScoreSynth } from '../engine/scoreSynth'
import { computeSections, type Section } from '../engine/sections'
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

const DEFAULT_MEASURES_PER_SECTION = 8
const MAX_EXERCISE_STAT_ROWS = 3

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

function isSectionPracticeMode(mode: PracticeMode): boolean {
  return mode === 'sectionFree' || mode === 'sectionTraining'
}

// Reproduces today's actual starting point for every (platform x sourceKind)
// combination: desktop always starts in Page free; mobile always starts in
// Scroll free (both real scores and generated exercises) -- this used to
// default a real score into Section training on mobile, but that's now just
// one of the choices in the mode picker rather than the starting point.
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
  const [correctNoteCount, setCorrectNoteCount] = useState(0)
  const [totalEvents, setTotalEvents] = useState(0)
  const [currentMeasure, setCurrentMeasure] = useState(1)
  const [zoom, setZoomValue] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [wrongNoteFeedback, setWrongNoteFeedback] = useState<string | null>(null)
  const [debugLog, setDebugLog] = useState<string[]>([])
  const [debugExpected, setDebugExpected] = useState('')
  const [debugHeld, setDebugHeld] = useState('')
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

  const [events, setEvents] = useState<ExpectedEvent[]>([])
  const [naturalBreaks, setNaturalBreaks] = useState<Set<number>>(new Set())
  const [measuresPerSection, setMeasuresPerSection] = useState(DEFAULT_MEASURES_PER_SECTION)
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
  const [sectionMessage, setSectionMessage] = useState<string | null>(null)

  // currentSectionIndex === sections.length is the implicit "Whole piece"
  // choice -- practice every event with no section boundary, same as being
  // in a non-section-scoped practiceMode.
  const sections = useMemo(
    () => computeSections(events, measuresPerSection, naturalBreaks),
    [events, measuresPerSection, naturalBreaks],
  )

  const backing = useBackingTrack(sourceKind === 'generated-training' ? backingTrack : null)

  const scoreRef = useRef<PianoScoreHandle | null>(null)
  // Kept so handleSelectHandMode can re-walk the already-loaded OSMD instance
  // to recompute ExpectedEvents for the new hand mode, without asking
  // PianoScore to remount/reparse the file (a hand-mode switch shouldn't pay
  // that cost -- the graphical score doesn't change, only which notes are
  // required).
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const waitEngineRef = useRef<WaitEngine | null>(null)
  const previousIndexRef = useRef(0)
  const eventsWithErrorsRef = useRef<Set<number>>(new Set())
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
  // errors within the CURRENT attempt of the current section (not the whole
  // session) -- resets every time a section (re)starts, see goToEventIndex.
  const sectionErrorCountRef = useRef(0)
  // The onNoteEvent effect below only runs once (stable deps), so it reads
  // practice-mode state through this ref rather than a stale closure value.
  const practiceModeRef = useRef(practiceMode)
  practiceModeRef.current = practiceMode
  const sectionsRef = useRef<Section[]>(sections)
  sectionsRef.current = sections
  const currentSectionIndexRef = useRef(currentSectionIndex)
  currentSectionIndexRef.current = currentSectionIndex
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
  const supportsSectionNavigation = sourceKind !== 'generated-training'
  const isSectionMode = isSectionPracticeMode(practiceMode)
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
      handMode: handModeRef.current,
      source: sessionSourceRef.current,
      totalEvents: totalEventsRef.current,
      eventsPlayed,
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
    // Once a session is on record as completed, no later snapshot may downgrade
    // it -- the heartbeat and the unmount that follows the End screen both still
    // run after finishSession.
    if (sessionCompletedRef.current) {
      return
    }
    sessionCompletedRef.current = completed
    saveSession(buildSessionRecord(completed))
  }

  // A wrong keypress within the chord tolerance window is reported but
  // doesn't erase already-held correct notes (see WaitEngine.noteOn) -- the
  // wrong key itself is shown on the virtual keyboard until this same window
  // elapses with no further input, at which point held progress actually
  // expires too (not just visually) and everything settles back to neutral.
  const scheduleDecay = () => {
    clearDecayTimer()
    decayTimeoutRef.current = setTimeout(() => {
      const engine = waitEngineRef.current
      if (engine) {
        engine.expireStaleHold(performance.now())
        scoreRef.current?.syncNotes(engine.currentHeldPitches)
        setDebugHeld(engine.currentHeldPitches.map(midiToNoteName).join(', '))
        setHeldPitches(engine.currentHeldPitches)
        setWrongPitches([])
      }
      decayTimeoutRef.current = null
    }, DEFAULT_CHORD_TOLERANCE_MS)
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

  // "Hear the tune" preview, unrelated to Wait Mode's gating: plays every note
  // of the whole piece (both hands, ignoring hand mode/section crop) via a
  // plain Web Audio synth, independent of the live practice cursor -- see
  // extractTimedNotes for why it walks its own OSMD iterator instead of the
  // shared osmd.cursor.
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
    synth.play(extractTimedNotes(osmd), () => setIsPreviewPlaying(false))
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

  const goToEventIndex = (targetIndex: number) => {
    const engine = waitEngineRef.current
    if (!engine) {
      return
    }
    clearDecayTimer()
    engine.jumpToEventIndex(targetIndex)
    scoreRef.current?.goToEventIndex(targetIndex)
    previousIndexRef.current = engine.state.currentIndex
    // Only the in-progress streak resets on a jump -- the session's best
    // combo (maxComboRef) is a record, not live progress, so it survives.
    comboRef.current = 0
    setCurrentCombo(0)
    // A fresh attempt of whatever section is landed on starts with 0 errors
    // so far, whether this jump is a repeat, an advance, or a manual pick.
    sectionErrorCountRef.current = 0
    setEngineState(engine.state)
    setCurrentMeasure(scoreRef.current?.getCurrentMeasure() ?? 1)
    setWrongNoteFeedback(null)
    setDebugExpected(engine.currentExpectedPitches.map(midiToNoteName).join(', '))
    setDebugHeld('')
    setExpectedPitches(engine.currentExpectedPitches)
    setHeldPitches([])
    setWrongPitches([])
    eventStartedAtRef.current = nowMs()
  }

  // Restricts the score to exactly one section's measures -- each section
  // reads like its own isolated mini-score (Simply-Piano-style), with no
  // leftover notes from the section just left still visible off to the side.
  // null means the whole piece (used for the explicit "Whole piece" choice
  // and when leaving a section-scoped mode).
  const applySectionBounds = (bounds: Section | null) => {
    scoreRef.current?.setSectionBounds(bounds ? bounds.startMeasure : null, bounds ? bounds.endMeasure : null)
  }

  // Shared by both completion paths below: the WaitEngine reaching its last
  // event (whole-piece modes), and a section-scoped mode clearing its last
  // section (see handleSectionCompleted) -- either one means the piece is
  // actually done, so both build and report the same SessionStats shape.
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

  // Called when the section currently being practiced has just been
  // completed (see the note-event handler below). Section free always
  // advances; section training only advances on a clean pass (zero errors
  // this attempt), otherwise it repeats the same section. Clearing the LAST
  // section ends the session right there -- no extra whole-piece replay.
  const handleSectionCompleted = () => {
    const wasPerfect = sectionErrorCountRef.current === 0
    const completedSectionNumber = currentSectionIndexRef.current + 1
    const shouldAdvance = practiceModeRef.current === 'sectionFree' || wasPerfect

    if (shouldAdvance) {
      const nextIndex = completedSectionNumber // 0-based next index === 1-based completed number
      const nextBounds = nextIndex < sectionsRef.current.length ? sectionsRef.current[nextIndex] : null
      if (nextBounds === null) {
        finishSession()
        return
      }
      setCurrentSectionIndex(nextIndex)
      // Cursor navigation MUST happen with NO crop active -- OSMD's own
      // tie/rest counting only lines up with WaitEngine's indices on the
      // fully uncropped model (the one extractExpectedEvents originally
      // walked). Walking with any crop active can corrupt that counting
      // whenever the walk doesn't pass through the crop's own drawn range
      // (confirmed: jumping forward past an adjacent section worked by
      // accident since the walk grazed the old crop, but jumping backward
      // past a non-adjacent one landed measures away with no highlight at
      // all). Always clear, walk, then crop to the new section.
      applySectionBounds(null)
      goToEventIndex(nextBounds.startEventIndex)
      applySectionBounds(nextBounds)
      showSectionMessage(`Section ${completedSectionNumber} complete! Moving to section ${nextIndex + 1}.`)
    } else {
      const activeSection = sectionsRef.current[currentSectionIndexRef.current]
      applySectionBounds(null)
      goToEventIndex(activeSection.startEventIndex)
      applySectionBounds(activeSection)
      showSectionMessage(`Section ${completedSectionNumber} had errors -- let's try again.`)
    }
  }

  useEffect(() => {
    return onNoteEvent((event) => {
      if (event.type !== 'noteon') {
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

      setDebugLog((log) =>
        [...log, `received ${midiToNoteName(event.pitch)} (${event.pitch}) -> ${status}`].slice(-10),
      )

      const activeSection =
        isSectionPracticeMode(practiceModeRef.current) && currentSectionIndexRef.current < sectionsRef.current.length
          ? sectionsRef.current[currentSectionIndexRef.current]
          : null

      if (status === 'error') {
        eventsWithErrorsRef.current.add(indexBeforeNote)
        errorCountRef.current += 1
        setErrorCount(errorCountRef.current)
        comboRef.current = 0
        setCurrentCombo(0)
        if (activeSection) {
          sectionErrorCountRef.current += 1
        }
        recordNoteError(expectedPitchesBeforeNote, event.pitch)
        scoreRef.current?.syncNotes(engine.currentHeldPitches)
        setWrongPitches((pitches) => [...pitches, event.pitch])
        scheduleDecay()
        const expectedNames = engine.currentExpectedPitches.map(midiToNoteName).join(', ')
        setWrongNoteFeedback(`Expected ${expectedNames} -- you played ${midiToNoteName(event.pitch)}`)
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
          if (!eventsWithErrorsRef.current.has(indexBeforeNote)) {
            comboRef.current += 1
            maxComboRef.current = Math.max(maxComboRef.current, comboRef.current)
            setCurrentCombo(comboRef.current)
            setBestCombo(maxComboRef.current)
          }
          scoreRef.current?.next()
          setCurrentMeasure(scoreRef.current?.getCurrentMeasure() ?? 1)
          previousIndexRef.current = newIndex

          if (activeSection && newIndex >= activeSection.endEventIndex) {
            // Finishing the LAST section ends the session immediately
            // (handleSectionCompleted calls finishSession itself in that
            // case) -- a bounded section only wins over plain completion
            // while there's another section still ahead of it.
            handleSectionCompleted()
          } else if (engine.state.completed) {
            finishSession()
          } else {
            eventStartedAtRef.current = nowMs()
          }
        } else {
          scoreRef.current?.syncNotes(engine.currentHeldPitches)
          scheduleDecay()
        }
      }
      setEngineState(engine.state)
      setDebugExpected(engine.currentExpectedPitches.map(midiToNoteName).join(', '))
      setDebugHeld(engine.currentHeldPitches.map(midiToNoteName).join(', '))
      setExpectedPitches(engine.currentExpectedPitches)
      setHeldPitches(engine.currentHeldPitches)
    })
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
    const freshNaturalBreaks = extractNaturalBreakMeasures(osmd)
    setNaturalBreaks(freshNaturalBreaks)
    // A remount (e.g. a layoutMode change from switching modes) loses any
    // previously-set section crop -- the `sections` memo above hasn't
    // recomputed yet at this point in the render cycle, so section 0's
    // bounds are derived fresh here instead of read from that stale value.
    if (isSectionPracticeMode(practiceMode)) {
      const freshSections = computeSections(newEvents, measuresPerSection, freshNaturalBreaks)
      scoreRef.current?.setSectionBounds(freshSections[0]?.startMeasure ?? null, freshSections[0]?.endMeasure ?? null)
    } else {
      scoreRef.current?.setSectionBounds(null, null)
    }
    waitEngineRef.current = new WaitEngine(newEvents)
    previousIndexRef.current = 0
    eventsWithErrorsRef.current = new Set()
    errorCountRef.current = 0
    comboRef.current = 0
    maxComboRef.current = 0
    correctNoteCountRef.current = 0
    resetNoteStats()
    sectionErrorCountRef.current = 0
    setCurrentCombo(0)
    setBestCombo(0)
    setCorrectNoteCount(0)
    setCurrentSectionIndex(0)
    setSectionMessage(null)
    startedAtRef.current = Date.now()
    setWrongNoteFeedback(null)
    setEngineState(waitEngineRef.current.state)
    setDebugExpected(waitEngineRef.current.currentExpectedPitches.map(midiToNoteName).join(', '))
    setDebugHeld('')
    setDebugLog([])
    // Page free never highlights anything -- see isFreePageMode.
    setExpectedPitches(practiceMode === 'page' ? [] : waitEngineRef.current.currentExpectedPitches)
    setHeldPitches([])
    setWrongPitches([])
    const allPitches = newEvents.flatMap((event) => event.pitches)
    if (allPitches.length > 0) {
      setPitchRange({ low: Math.min(...allPitches), high: Math.max(...allPitches) })
    }
    if (practiceMode !== 'page') {
      scoreRef.current?.syncNotes([])
    }
  }

  const handleZoomChange = (value: number) => {
    setZoomValue(value)
    scoreRef.current?.setZoom(value)
  }

  const handleBackToStart = () => goToEventIndex(0)

  // Every measure-addressed cursor jump goes through here -- desktop's "Go to
  // measure" box and mobile's long press on the staff -- so the two can never
  // disagree about what a jump means. Two things it has to get right in a
  // section mode, neither of which the earlier jump-to-measure did: the crop
  // follows the target measure into whichever section contains it (a jump
  // outside the drawn range otherwise left the cursor on measures that aren't
  // on screen), and the cursor walk itself runs with NO crop active, per the
  // rule handleSectionCompleted documents. Returns whether a jump actually
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
    // Outside a section mode, and on the explicit "Whole piece" choice inside
    // one, no crop is active and none should become active -- cropping here
    // would cost a full render to narrow the score the player just chose to
    // see in full.
    if (!isSectionMode || currentSectionIndex >= sections.length) {
      goToEventIndex(eventIndex)
      return true
    }
    const target = sections.find(
      (section) => eventIndex >= section.startEventIndex && eventIndex < section.endEventIndex,
    )
    setCurrentSectionIndex(target ? target.index : sections.length)
    applySectionBounds(null)
    goToEventIndex(eventIndex)
    applySectionBounds(target ?? null)
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

  // Manual section navigation (dropdown or Prev/Next) always jumps
  // immediately, bypassing the perfect-run requirement -- that gate only
  // applies to automatic advancement.
  const handleSelectSection = (newSectionIndex: number) => {
    setCurrentSectionIndex(newSectionIndex)
    setSectionMessage(null)
    const bounds = newSectionIndex < sections.length ? sections[newSectionIndex] : null
    // See handleSectionCompleted for why the cursor jump must happen with no
    // crop active at all, not just before the NEW crop is applied.
    applySectionBounds(null)
    goToEventIndex(bounds ? bounds.startEventIndex : 0)
    applySectionBounds(bounds)
  }

  const handlePrevSection = () => handleSelectSection(Math.max(0, currentSectionIndex - 1))
  const handleNextSection = () => handleSelectSection(Math.min(sections.length, currentSectionIndex + 1))
  const handleBackToSection1 = () => handleSelectSection(0)

  const handleSelectPracticeMode = (newMode: PracticeMode) => {
    if (newMode === practiceMode) {
      return
    }
    const entering = isSectionPracticeMode(newMode)
    const wasIn = isSectionPracticeMode(practiceMode)
    setPracticeMode(newMode)
    setSectionMessage(null)

    if (entering && !wasIn) {
      // Fresh entry into section-scoped practice: always restart at section 1.
      setCurrentSectionIndex(0)
      applySectionBounds(null)
      goToEventIndex(0)
      applySectionBounds(sections[0] ?? null)
    } else if (!entering && wasIn) {
      // Leaving section-scoped practice: clear the crop, THEN walk -- see
      // handleSectionCompleted for why the cursor walk must always happen
      // with no crop active (OSMD's own tie/rest counting only lines up with
      // WaitEngine's indices on the fully uncropped model). cursor.show()
      // alone doesn't reliably relocate onto the freshly-uncropped, much
      // larger graphical model either, so a fresh walk is required even
      // though the logical index isn't changing.
      applySectionBounds(null)
      goToEventIndex(waitEngineRef.current?.state.currentIndex ?? 0)
    }
    // else: page <-> scroll (no section state to touch), or sectionFree <->
    // sectionTraining (already section-scoped, stays put -- only the
    // completion rule used by handleSectionCompleted changes).
  }

  const handleMeasuresPerSectionChange = (value: number) => {
    if (!Number.isFinite(value) || value < 1) {
      return
    }
    setMeasuresPerSection(value)
    setSectionMessage(null)
    // The `sections` memo hasn't recomputed yet at this point, so the new
    // section 0 is derived fresh here, same pattern as handleReady -- this is
    // only reachable while already in a section mode (the input is gated by
    // isSectionMode), so re-cropping to it is always correct.
    const freshSections = computeSections(events, value, naturalBreaks)
    setCurrentSectionIndex(0)
    applySectionBounds(null)
    goToEventIndex(freshSections[0]?.startEventIndex ?? 0)
    applySectionBounds(freshSections[0] ?? null)
  }

  // Live hand-mode switch: which notes are required changes, which changes
  // how many cursor positions count as a real event (a step where only the
  // deselected hand plays is no longer required at all) -- so the event
  // count/indices can shift, and the safest thing is to recompute events and
  // restart from the current section (or the very start outside section
  // modes), same trade-off already made for a layoutMode remount.
  const handleSelectHandMode = (newHandMode: HandMode) => {
    if (newHandMode === handMode) {
      return
    }
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
    // The section crop currently applied would otherwise confine this walk to
    // that one section's measures, so the fresh event list (and the WaitEngine
    // built from it) would cover the section instead of the piece -- the same
    // "always walk with no crop active" rule setSectionBounds documents. Only
    // touched in a section mode: clearing bounds costs a full render, and there
    // is nothing to clear outside those modes.
    const inSectionMode = isSectionPracticeMode(practiceMode)
    if (inSectionMode) {
      applySectionBounds(null)
    }
    const newEvents = extractExpectedEvents(osmd, newHandMode)
    totalEventsRef.current = newEvents.length
    setTotalEvents(newEvents.length)
    setEvents(newEvents)
    waitEngineRef.current = new WaitEngine(newEvents)
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

    if (inSectionMode) {
      const freshSections = computeSections(newEvents, measuresPerSection, naturalBreaks)
      setCurrentSectionIndex(0)
      goToEventIndex(freshSections[0]?.startEventIndex ?? 0)
      applySectionBounds(freshSections[0] ?? null)
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

  // Mobile gets a single compact icon-button header (name, home, back-to-
  // section-1, prev/next section) with every other row -- HUD, the desktop
  // controls, the training panel, banners, the debug panel -- omitted
  // entirely so the score gets the whole rest of a landscape phone screen.
  // Gamification stats still update underneath, just without a home for
  // showing them on this screen yet.
  if (isMobile) {
    return (
      <div className="flex h-screen w-full flex-col">
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
            value={practiceMode}
            onChange={(e) => handleSelectPracticeMode(e.target.value as PracticeMode)}
            aria-label="Practice mode"
            className="w-20 shrink-0 rounded-md border border-gray-300 bg-white px-1 py-1.5 text-xs"
          >
            <option value="page">Page</option>
            <option value="scroll">Scroll</option>
            {supportsSectionNavigation && <option value="sectionFree">Sect. free</option>}
            {supportsSectionNavigation && <option value="sectionTraining">Sect. drill</option>}
          </select>
          <select
            value={handMode}
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
          {supportsSectionNavigation && isSectionMode ? (
            <>
              <button
                type="button"
                onClick={handleBackToSection1}
                aria-label="Back to section 1"
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
              >
                <SkipToStartIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handlePrevSection}
                aria-label="Previous section"
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handleNextSection}
                aria-label="Next section"
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </>
          ) : (
            !isFreePageMode && (
              <button
                type="button"
                onClick={handleBackToStart}
                aria-label="Back to start"
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100"
              >
                <SkipToStartIcon className="h-5 w-5" />
              </button>
            )
          )}
        </div>

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
            onError={setLoadError}
          />
          {/* Mobile had no home for sectionMessage at all, so a section
              repeat/advance was silent here. Floated over the score rather
              than given a row of its own: a landscape phone has no vertical
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
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-[1600px] flex-col gap-4 px-6 py-6">
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
        currentCombo={currentCombo}
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
            value={practiceMode}
            onChange={(e) => handleSelectPracticeMode(e.target.value as PracticeMode)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1"
          >
            <option value="page">Page free</option>
            <option value="scroll">Scroll free</option>
            {supportsSectionNavigation && <option value="sectionFree">Section free</option>}
            {supportsSectionNavigation && <option value="sectionTraining">Section training</option>}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Hand
          <select
            value={handMode}
            onChange={(e) => handleSelectHandMode(e.target.value as HandMode)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1"
          >
            <option value="both">Both hands</option>
            <option value="right">Right hand</option>
            <option value="left">Left hand</option>
          </select>
        </label>
      </div>

      {supportsSectionNavigation && isSectionMode && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
          <label className="flex items-center gap-2">
            Section
            <select
              value={currentSectionIndex}
              onChange={(e) => handleSelectSection(Number(e.target.value))}
              className="rounded-md border border-indigo-300 bg-white px-2 py-1"
            >
              {sections.map((section) => (
                <option key={section.index} value={section.index}>
                  Section {section.index + 1} ({section.label})
                </option>
              ))}
              <option value={sections.length}>Whole piece</option>
            </select>
          </label>
          <button
            type="button"
            onClick={handlePrevSection}
            className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 hover:bg-indigo-100"
          >
            Prev section
          </button>
          <button
            type="button"
            onClick={handleNextSection}
            className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 hover:bg-indigo-100"
          >
            Next section
          </button>
          <label className="flex items-center gap-2">
            Measures per section
            <input
              type="number"
              min={1}
              value={measuresPerSection}
              onChange={(e) => handleMeasuresPerSectionChange(Number(e.target.value))}
              className="w-16 rounded-md border border-indigo-300 bg-white px-2 py-1"
            />
          </label>
          {currentSectionIndex < sections.length && (
            <span>
              {practiceMode === 'sectionTraining'
                ? 'Any error repeats this section -- a clean pass advances.'
                : 'Advances automatically once you reach the end of the section.'}
            </span>
          )}
        </div>
      )}

      {sectionMessage && <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700">{sectionMessage}</p>}

      {wrongNoteFeedback && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{wrongNoteFeedback}</p>}

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 font-mono text-xs text-amber-900">
        <p>DEBUG -- expected: [{debugExpected}] -- held: [{debugHeld}]</p>
        <p className="mt-1 whitespace-pre-wrap">{debugLog.join('\n')}</p>
      </div>

      <PianoScore
        ref={scoreRef}
        source={scoreFile}
        layoutMode={resolvedLayoutMode}
        handMode={handMode}
        onReady={handleReady}
        onError={setLoadError}
      />

      {showDesktopKeyboard && (
        <VirtualKeyboard
          lowestPitch={pitchRange.low}
          highestPitch={pitchRange.high}
          expectedPitches={expectedPitches}
          heldPitches={heldPitches}
          wrongPitches={wrongPitches}
        />
      )}
    </div>
  )
}
