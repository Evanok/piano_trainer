import { useEffect, useMemo, useRef, useState } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon, SettingsIcon, SkipToStartIcon } from '../components/icons'
import { PianoScore, type LayoutMode, type PianoScoreHandle } from '../components/PianoScore'
import { ScoreHud } from '../components/ScoreHud'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { extractExpectedEvents, extractNaturalBreakMeasures } from '../engine/ScoreParser'
import { recordExerciseSession } from '../engine/exerciseStatsStore'
import { computeSections, type Section } from '../engine/sections'
import { DEFAULT_CHORD_TOLERANCE_MS, WaitEngine, type WaitEngineState } from '../engine/WaitEngine'
import { midiToNoteName } from '../engine/noteNames'
import { recordPracticeDay } from '../engine/streakStore'
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
import type { ExerciseSessionStats, SessionStats } from '../types/session'

const DEFAULT_MEASURES_PER_SECTION = 8
const MAX_EXERCISE_STAT_ROWS = 3

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function isSectionPracticeMode(mode: PracticeMode): boolean {
  return mode === 'sectionFree' || mode === 'sectionTraining'
}

// Reproduces today's actual starting point for every (platform x sourceKind)
// combination: desktop always starts in Page free; mobile starts in Section
// training for real scores (its historical forced-drill default, now just a
// starting point instead of a permanent lock) and Scroll free for generated
// exercises (which have no sections to drill).
function defaultPracticeMode(sourceKind: PracticeSourceKind, isMobile: boolean): PracticeMode {
  const supportsSectionNavigation = sourceKind !== 'generated-training'
  if (isMobile) {
    return supportsSectionNavigation ? 'sectionTraining' : 'scroll'
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
  keyboardAssistMode: KeyboardAssistMode
  backingTrack: PracticeBackingTrack | null
  keySignature: PracticeKeySignature | null
  onNoteEvent: (listener: (event: MidiNoteEvent) => void) => () => void
  onComplete: (stats: SessionStats) => void
  onBack: () => void
  onExerciseSettings?: () => void
}

export function Practice({
  scoreFile,
  sourceKind,
  keyboardAssistMode,
  backingTrack,
  keySignature,
  onNoteEvent,
  onComplete,
  onBack,
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
  const sectionMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const supportsSectionNavigation = sourceKind !== 'generated-training'
  const isSectionMode = isSectionPracticeMode(practiceMode)
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

  const resetExerciseStats = () => {
    eventStartedAtRef.current = nowMs()
    responseTimesRef.current = []
    missedNoteCountsRef.current = new Map()
    wrongNoteCountsRef.current = new Map()
    confusionCountsRef.current = new Map()
  }

  const recordExerciseError = (expectedPitchesForEvent: number[], playedPitch: number) => {
    if (sourceKindRef.current !== 'generated-training') {
      return
    }

    expectedPitchesForEvent.forEach((pitch) => incrementCount(missedNoteCountsRef.current, pitch))
    incrementCount(wrongNoteCountsRef.current, playedPitch)

    const expected = expectedPitchesForEvent.map(midiToNoteName).join(', ')
    const played = midiToNoteName(playedPitch)
    const key = expected + ' -> ' + played
    const existing = confusionCountsRef.current.get(key)
    confusionCountsRef.current.set(key, { expected, played, count: (existing?.count ?? 0) + 1 })
  }

  const recordExerciseResponse = () => {
    if (sourceKindRef.current !== 'generated-training') {
      return
    }
    responseTimesRef.current.push(Math.max(0, nowMs() - eventStartedAtRef.current))
  }

  const buildExerciseStats = () =>
    sourceKindRef.current === 'generated-training'
      ? summarizeExerciseStats(
          responseTimesRef.current,
          missedNoteCountsRef.current,
          wrongNoteCountsRef.current,
          confusionCountsRef.current,
        )
      : undefined

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
      if (sectionMessageTimeoutRef.current !== null) {
        clearTimeout(sectionMessageTimeoutRef.current)
      }
    }
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

  // Called when the section currently being practiced has just been
  // completed (see the note-event handler below). Section free always
  // advances; section training only advances on a clean pass (zero errors
  // this attempt), otherwise it repeats the same section.
  const handleSectionCompleted = () => {
    const wasPerfect = sectionErrorCountRef.current === 0
    const completedSectionNumber = currentSectionIndexRef.current + 1
    const shouldAdvance = practiceModeRef.current === 'sectionFree' || wasPerfect

    if (shouldAdvance) {
      const nextIndex = completedSectionNumber // 0-based next index === 1-based completed number
      const nextBounds = nextIndex < sectionsRef.current.length ? sectionsRef.current[nextIndex] : null
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
      goToEventIndex(nextBounds ? nextBounds.startEventIndex : 0)
      applySectionBounds(nextBounds)
      showSectionMessage(
        nextBounds
          ? `Section ${completedSectionNumber} complete! Moving to section ${nextIndex + 1}.`
          : 'All sections complete! Now practice the whole piece.',
      )
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
        recordExerciseError(expectedPitchesBeforeNote, event.pitch)
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
          recordExerciseResponse()
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
            // A bounded section always wins over whole-piece completion --
            // the LAST section's end coincides with the piece's end, but
            // finishing it should offer a distinct final "whole piece" pass
            // rather than immediately ending the session.
            handleSectionCompleted()
          } else if (engine.state.completed) {
            const total = totalEventsRef.current
            const exercise = buildExerciseStats()
            const stats: SessionStats = {
              durationMs: Date.now() - startedAtRef.current,
              errorCount: errorCountRef.current,
              totalEvents: total,
              successPercent: Math.round((100 * (total - eventsWithErrorsRef.current.size)) / total),
              maxCombo: maxComboRef.current,
              ...(exercise ? { exercise } : {}),
            }
            recordExerciseSession(scoreFile.name, stats)
            onComplete(stats)
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
    resetExerciseStats()
    sectionErrorCountRef.current = 0
    setCurrentCombo(0)
    setBestCombo(0)
    setCorrectNoteCount(0)
    setCurrentSectionIndex(0)
    setSectionMessage(null)
    startedAtRef.current = Date.now()
    recordPracticeDay()
    setWrongNoteFeedback(null)
    setEngineState(waitEngineRef.current.state)
    setDebugExpected(waitEngineRef.current.currentExpectedPitches.map(midiToNoteName).join(', '))
    setDebugHeld('')
    setDebugLog([])
    setExpectedPitches(waitEngineRef.current.currentExpectedPitches)
    setHeldPitches([])
    setWrongPitches([])
    const allPitches = newEvents.flatMap((event) => event.pitches)
    if (allPitches.length > 0) {
      setPitchRange({ low: Math.min(...allPitches), high: Math.max(...allPitches) })
    }
    scoreRef.current?.syncNotes([])
  }

  const handleZoomChange = (value: number) => {
    setZoomValue(value)
    scoreRef.current?.setZoom(value)
  }

  const handleBackToStart = () => goToEventIndex(0)

  const handleJumpToMeasure = () => {
    const engine = waitEngineRef.current
    const measureNumber = Number(measureInputValue)
    if (!engine || !Number.isFinite(measureNumber) || measureNumber < 1) {
      return
    }
    const eventIndex = engine.findEventIndexForMeasure(measureNumber)
    if (eventIndex !== null) {
      goToEventIndex(eventIndex)
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
    resetExerciseStats()
    setSectionMessage(null)

    if (isSectionPracticeMode(practiceMode)) {
      const freshSections = computeSections(newEvents, measuresPerSection, naturalBreaks)
      setCurrentSectionIndex(0)
      applySectionBounds(null)
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
  const showMobileKeyboard = sourceKind !== 'generated-training' || showGeneratedAssistKeyboard
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

        <PianoScore
          ref={scoreRef}
          source={scoreFile}
          layoutMode={resolvedLayoutMode}
          handMode={handMode}
          onReady={handleReady}
          onError={setLoadError}
        />

        {/* Always on for regular scores (no toggle button fits in the compact
            header). Generated exercises follow the setup assistance mode: hidden,
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
