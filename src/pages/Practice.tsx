import { useEffect, useMemo, useRef, useState } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon, SkipToStartIcon } from '../components/icons'
import { PianoScore, type LayoutMode, type PianoScoreHandle } from '../components/PianoScore'
import { ScoreHud } from '../components/ScoreHud'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { extractExpectedEvents, extractNaturalBreakMeasures } from '../engine/ScoreParser'
import { computeSections, type Section } from '../engine/sections'
import { DEFAULT_CHORD_TOLERANCE_MS, WaitEngine, type WaitEngineState } from '../engine/WaitEngine'
import { midiToNoteName } from '../engine/noteNames'
import { recordPracticeDay } from '../engine/streakStore'
import { useIsMobile } from '../hooks/useIsMobile'
import type { ExpectedEvent } from '../types/score'
import type { MidiNoteEvent } from '../types/midi'
import type { PracticeSourceKind } from '../types/practice'
import type { SessionStats } from '../types/session'

const DEFAULT_MEASURES_PER_SECTION = 8
// A section only auto-advances once it's been played through with zero
// errors this many times IN A ROW -- one clean pass isn't enough to prove
// it's learned, but requiring more would make repetitive drilling tedious.
const PERFECT_RUNS_TO_ADVANCE = 2

interface PracticeProps {
  scoreFile: File
  sourceKind: PracticeSourceKind
  onNoteEvent: (listener: (event: MidiNoteEvent) => void) => () => void
  onComplete: (stats: SessionStats) => void
  onBack: () => void
}

export function Practice({ scoreFile, sourceKind, onNoteEvent, onComplete, onBack }: PracticeProps) {
  // Mobile only ever gets scroll mode (and training mode, built on top of
  // it) -- the paginated page layout and the dense desktop control row don't
  // work well on a phone screen. See useIsMobile for the breakpoint.
  const isMobile = useIsMobile()
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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => (isMobile ? 'scroll' : 'page'))
  const [expectedPitches, setExpectedPitches] = useState<number[]>([])
  const [heldPitches, setHeldPitches] = useState<number[]>([])
  const [pitchRange, setPitchRange] = useState({ low: 60, high: 72 })
  const [wrongPitches, setWrongPitches] = useState<number[]>([])

  // Training mode: split the piece into sections, drill one at a time.
  const [trainingMode, setTrainingMode] = useState(false)
  const [events, setEvents] = useState<ExpectedEvent[]>([])
  const [naturalBreaks, setNaturalBreaks] = useState<Set<number>>(new Set())
  const [measuresPerSection, setMeasuresPerSection] = useState(DEFAULT_MEASURES_PER_SECTION)
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
  const [sectionPerfectStreak, setSectionPerfectStreak] = useState(0)
  const [sectionMessage, setSectionMessage] = useState<string | null>(null)

  // currentSectionIndex === sections.length is the implicit "Whole piece"
  // choice -- practice every event with no section boundary, same as
  // training mode being off.
  const sections = useMemo(
    () => computeSections(events, measuresPerSection, naturalBreaks),
    [events, measuresPerSection, naturalBreaks],
  )

  const scoreRef = useRef<PianoScoreHandle | null>(null)
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
  const startedAtRef = useRef(Date.now())
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sectionMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // errors within the CURRENT attempt of the current section (not the whole
  // session) -- resets every time a section (re)starts, see goToEventIndex.
  const sectionErrorCountRef = useRef(0)
  // The onNoteEvent effect below only runs once (stable deps), so it reads
  // training-mode state through these refs rather than stale closure values.
  const trainingModeRef = useRef(trainingMode)
  trainingModeRef.current = trainingMode
  const sectionsRef = useRef<Section[]>(sections)
  sectionsRef.current = sections
  const currentSectionIndexRef = useRef(currentSectionIndex)
  currentSectionIndexRef.current = currentSectionIndex
  const sectionPerfectStreakRef = useRef(sectionPerfectStreak)
  sectionPerfectStreakRef.current = sectionPerfectStreak

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

  // Covers becoming mobile mid-session (resize, orientation change) -- the
  // initial state above only handles starting out mobile.
  useEffect(() => {
    if (isMobile) {
      setLayoutMode('scroll')
    }
  }, [isMobile])

  // Mobile's compact header has no training-mode toggle -- section
  // navigation (back-to-section-1, prev/next) IS the mobile practice mode,
  // always on, not something to opt into. Guarded by trainingMode so this
  // only fires once per isMobile transition, not on every render.
  useEffect(() => {
    if (isMobile && !trainingMode) {
      enterTrainingMode()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, trainingMode])

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
  }

  // Restricts the score to exactly one section's measures -- each section
  // reads like its own isolated mini-score (Simply-Piano-style), with no
  // leftover notes from the section just left still visible off to the side.
  // null means the whole piece (used for the explicit "Whole piece" choice
  // and when exiting training mode).
  const applySectionBounds = (bounds: Section | null) => {
    scoreRef.current?.setSectionBounds(bounds ? bounds.startMeasure : null, bounds ? bounds.endMeasure : null)
  }

  // Called when the section currently being drilled has just been completed
  // (see the note-event handler below). Advances only once it's been played
  // perfectly PERFECT_RUNS_TO_ADVANCE times in a row -- otherwise repeats the
  // same section, keeping the streak so the next attempt still counts toward it.
  const handleSectionCompleted = () => {
    const wasPerfect = sectionErrorCountRef.current === 0
    const streak = wasPerfect ? sectionPerfectStreakRef.current + 1 : 0
    setSectionPerfectStreak(streak)

    const completedSectionNumber = currentSectionIndexRef.current + 1
    if (streak >= PERFECT_RUNS_TO_ADVANCE) {
      const nextIndex = completedSectionNumber // 0-based next index === 1-based completed number
      const nextBounds = nextIndex < sectionsRef.current.length ? sectionsRef.current[nextIndex] : null
      setCurrentSectionIndex(nextIndex)
      setSectionPerfectStreak(0)
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
          ? `Section ${completedSectionNumber} mastered! Moving to section ${nextIndex + 1}.`
          : 'All sections mastered! Now practice the whole piece.',
      )
    } else {
      const activeSection = sectionsRef.current[currentSectionIndexRef.current]
      applySectionBounds(null)
      goToEventIndex(activeSection.startEventIndex)
      applySectionBounds(activeSection)
      showSectionMessage(
        wasPerfect
          ? `Section ${completedSectionNumber} clean! One more perfect run to advance.`
          : `Section ${completedSectionNumber} had errors -- let's try again.`,
      )
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
      const status = engine.noteOn(event.pitch, event.timestamp)

      setDebugLog((log) =>
        [...log, `received ${midiToNoteName(event.pitch)} (${event.pitch}) -> ${status}`].slice(-10),
      )

      const activeSection =
        trainingModeRef.current && currentSectionIndexRef.current < sectionsRef.current.length
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
            onComplete({
              durationMs: Date.now() - startedAtRef.current,
              errorCount: errorCountRef.current,
              totalEvents: total,
              successPercent: Math.round((100 * (total - eventsWithErrorsRef.current.size)) / total),
              maxCombo: maxComboRef.current,
            })
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
    const newEvents = extractExpectedEvents(osmd)
    totalEventsRef.current = newEvents.length
    setTotalEvents(newEvents.length)
    setEvents(newEvents)
    const freshNaturalBreaks = extractNaturalBreakMeasures(osmd)
    setNaturalBreaks(freshNaturalBreaks)
    // A remount (e.g. entering training mode, which forces scroll layout)
    // loses any previously-set section crop -- the `sections` memo above
    // hasn't recomputed yet at this point in the render cycle, so section 0's
    // bounds are derived fresh here instead of read from that stale value.
    if (trainingMode) {
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
    sectionErrorCountRef.current = 0
    setCurrentCombo(0)
    setBestCombo(0)
    setCorrectNoteCount(0)
    setCurrentSectionIndex(0)
    setSectionPerfectStreak(0)
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
    setSectionPerfectStreak(0)
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

  const enterTrainingMode = () => {
    setTrainingMode(true)
    setCurrentSectionIndex(0)
    setSectionPerfectStreak(0)
    setLayoutMode('scroll')
    applySectionBounds(null)
    goToEventIndex(0)
    applySectionBounds(sections[0] ?? null)
  }

  const exitTrainingMode = () => {
    setTrainingMode(false)
    // Clear the crop, THEN walk -- see handleSectionCompleted for why the
    // cursor walk must always happen with no crop active (OSMD's own
    // tie/rest counting only lines up with WaitEngine's indices on the
    // fully uncropped model). cursor.show() alone doesn't reliably relocate
    // onto the freshly-uncropped, much larger graphical model either, so a
    // fresh walk is required even though the logical index isn't changing.
    applySectionBounds(null)
    goToEventIndex(waitEngineRef.current?.state.currentIndex ?? 0)
  }

  const handleToggleTrainingMode = () => (trainingMode ? exitTrainingMode() : enterTrainingMode())

  const handleMeasuresPerSectionChange = (value: number) => {
    if (Number.isFinite(value) && value >= 1) {
      setMeasuresPerSection(value)
      setCurrentSectionIndex(0)
      setSectionPerfectStreak(0)
    }
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
  const showMobileKeyboard = sourceKind !== 'generated-training'

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
          <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-gray-900">{scoreFile.name}</h1>
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
        </div>

        <PianoScore
          ref={scoreRef}
          source={scoreFile}
          layoutMode="scroll"
          onReady={handleReady}
          onError={setLoadError}
        />

        {/* Always on for regular scores (no toggle button fits in the compact
            header) -- on a small screen, re-reading the expected chord off
            the sheet after a mistake is slow; the keyboard gives an immediate
            reference exactly where a mis-hit note is also shown red. Generated
            exercises hide it so the keyboard does not give away the answer. */}
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{scoreFile.name}</h1>
        <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline">
          Back to home
        </button>
      </div>

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
        <button
          type="button"
          onClick={() => setShowKeyboard((value) => !value)}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50"
        >
          {showKeyboard ? 'Hide keyboard' : 'Show keyboard'}
        </button>
        {!trainingMode && (
          <button
            type="button"
            onClick={() => setLayoutMode((mode) => (mode === 'page' ? 'scroll' : 'page'))}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50"
          >
            {layoutMode === 'page' ? 'Switch to scroll mode' : 'Switch to page mode'}
          </button>
        )}
        <button
          type="button"
          onClick={handleToggleTrainingMode}
          className={
            trainingMode
              ? 'rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-sm text-indigo-700 hover:bg-indigo-100'
              : 'rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50'
          }
        >
          {trainingMode ? 'Exit section drill' : 'Start section drill'}
        </button>
      </div>

      {trainingMode && (
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
              Perfect runs: {sectionPerfectStreak}/{PERFECT_RUNS_TO_ADVANCE} to advance
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
        layoutMode={trainingMode ? 'scroll' : layoutMode}
        onReady={handleReady}
        onError={setLoadError}
      />

      {showKeyboard && (
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
