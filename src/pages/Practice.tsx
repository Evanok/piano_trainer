import { useEffect, useRef, useState } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { PianoScore, type LayoutMode, type PianoScoreHandle } from '../components/PianoScore'
import { VirtualKeyboard } from '../components/VirtualKeyboard'
import { extractExpectedEvents } from '../engine/ScoreParser'
import { DEFAULT_CHORD_TOLERANCE_MS, WaitEngine, type WaitEngineState } from '../engine/WaitEngine'
import { midiToNoteName } from '../engine/noteNames'
import type { MidiNoteEvent } from '../types/midi'
import type { SessionStats } from '../types/session'

interface PracticeProps {
  scoreFile: File
  onNoteEvent: (listener: (event: MidiNoteEvent) => void) => () => void
  onComplete: (stats: SessionStats) => void
  onBack: () => void
}

export function Practice({ scoreFile, onNoteEvent, onComplete, onBack }: PracticeProps) {
  const [engineState, setEngineState] = useState<WaitEngineState | null>(null)
  const [errorCount, setErrorCount] = useState(0)
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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('page')
  const [expectedPitches, setExpectedPitches] = useState<number[]>([])
  const [heldPitches, setHeldPitches] = useState<number[]>([])
  const [pitchRange, setPitchRange] = useState({ low: 60, high: 72 })
  const [wrongPitches, setWrongPitches] = useState<number[]>([])

  const scoreRef = useRef<PianoScoreHandle | null>(null)
  const waitEngineRef = useRef<WaitEngine | null>(null)
  const previousIndexRef = useRef(0)
  const eventsWithErrorsRef = useRef<Set<number>>(new Set())
  const errorCountRef = useRef(0)
  const totalEventsRef = useRef(0)
  const startedAtRef = useRef(Date.now())
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearDecayTimer = () => {
    if (decayTimeoutRef.current !== null) {
      clearTimeout(decayTimeoutRef.current)
      decayTimeoutRef.current = null
    }
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
    return () => clearDecayTimer()
  }, [])

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

      if (status === 'error') {
        eventsWithErrorsRef.current.add(indexBeforeNote)
        errorCountRef.current += 1
        setErrorCount(errorCountRef.current)
        scoreRef.current?.syncNotes(engine.currentHeldPitches)
        setWrongPitches((pitches) => [...pitches, event.pitch])
        scheduleDecay()
        const expectedNames = engine.currentExpectedPitches.map(midiToNoteName).join(', ')
        setWrongNoteFeedback(`Expected ${expectedNames} -- you played ${midiToNoteName(event.pitch)}`)
      } else {
        setWrongNoteFeedback(null)
        const newIndex = engine.state.currentIndex
        if (newIndex > previousIndexRef.current) {
          clearDecayTimer()
          setWrongPitches([])
          scoreRef.current?.next()
          setCurrentMeasure(scoreRef.current?.getCurrentMeasure() ?? 1)
          previousIndexRef.current = newIndex
          if (engine.state.completed) {
            const total = totalEventsRef.current
            onComplete({
              durationMs: Date.now() - startedAtRef.current,
              errorCount: errorCountRef.current,
              totalEvents: total,
              successPercent: Math.round((100 * (total - eventsWithErrorsRef.current.size)) / total),
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
  }, [onNoteEvent, onComplete])

  const handleReady = (osmd: OpenSheetMusicDisplay) => {
    clearDecayTimer()
    const events = extractExpectedEvents(osmd)
    totalEventsRef.current = events.length
    setTotalEvents(events.length)
    waitEngineRef.current = new WaitEngine(events)
    previousIndexRef.current = 0
    eventsWithErrorsRef.current = new Set()
    errorCountRef.current = 0
    startedAtRef.current = Date.now()
    setWrongNoteFeedback(null)
    setEngineState(waitEngineRef.current.state)
    setDebugExpected(waitEngineRef.current.currentExpectedPitches.map(midiToNoteName).join(', '))
    setDebugHeld('')
    setDebugLog([])
    setExpectedPitches(waitEngineRef.current.currentExpectedPitches)
    setHeldPitches([])
    setWrongPitches([])
    const allPitches = events.flatMap((event) => event.pitches)
    if (allPitches.length > 0) {
      setPitchRange({ low: Math.min(...allPitches), high: Math.max(...allPitches) })
    }
    scoreRef.current?.syncNotes([])
  }

  const handleZoomChange = (value: number) => {
    setZoomValue(value)
    scoreRef.current?.setZoom(value)
  }

  const goToEventIndex = (targetIndex: number) => {
    const engine = waitEngineRef.current
    if (!engine) {
      return
    }
    clearDecayTimer()
    engine.jumpToEventIndex(targetIndex)
    scoreRef.current?.goToEventIndex(targetIndex)
    previousIndexRef.current = engine.state.currentIndex
    setEngineState(engine.state)
    setCurrentMeasure(scoreRef.current?.getCurrentMeasure() ?? 1)
    setWrongNoteFeedback(null)
    setDebugExpected(engine.currentExpectedPitches.map(midiToNoteName).join(', '))
    setDebugHeld('')
    setExpectedPitches(engine.currentExpectedPitches)
    setHeldPitches([])
    setWrongPitches([])
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

  return (
    <div className="mx-auto flex h-screen w-full max-w-[1600px] flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{scoreFile.name}</h1>
        <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline">
          Back to home
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
        <span>
          Measure {currentMeasure} -- Event {displayedIndex} / {totalEvents}
        </span>
        <span>Errors: {errorCount}</span>
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
        <button
          type="button"
          onClick={() => setLayoutMode((mode) => (mode === 'page' ? 'scroll' : 'page'))}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm hover:bg-gray-50"
        >
          {layoutMode === 'page' ? 'Switch to scroll mode' : 'Switch to page mode'}
        </button>
      </div>

      {wrongNoteFeedback && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{wrongNoteFeedback}</p>}

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 font-mono text-xs text-amber-900">
        <p>DEBUG -- expected: [{debugExpected}] -- held: [{debugHeld}]</p>
        <p className="mt-1 whitespace-pre-wrap">{debugLog.join('\n')}</p>
      </div>

      <PianoScore
        ref={scoreRef}
        source={scoreFile}
        layoutMode={layoutMode}
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
