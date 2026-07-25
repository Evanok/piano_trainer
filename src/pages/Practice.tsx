import { useEffect, useRef, useState } from 'react'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { PianoScore, type PianoScoreHandle } from '../components/PianoScore'
import { MidiDevice } from '../components/MidiDevice'
import { useMidi } from '../hooks/useMidi'
import { extractExpectedEvents } from '../engine/ScoreParser'
import { WaitEngine, type WaitEngineState } from '../engine/WaitEngine'

const FIXTURE_URL = '/samples/scale-c4-f4.musicxml'

export function Practice() {
  const [musicXml, setMusicXml] = useState<string | null>(null)
  const [engineState, setEngineState] = useState<WaitEngineState | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [totalEvents, setTotalEvents] = useState(0)

  const scoreRef = useRef<PianoScoreHandle | null>(null)
  const waitEngineRef = useRef<WaitEngine | null>(null)
  const previousIndexRef = useRef(0)

  const { devices, selectedDeviceId, selectDevice, isSupported, error, onNoteEvent } = useMidi()

  useEffect(() => {
    fetch(FIXTURE_URL)
      .then((res) => res.text())
      .then(setMusicXml)
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
      const status = engine.noteOn(event.pitch, event.timestamp)
      if (status === 'error') {
        scoreRef.current?.markError()
        setErrorCount((count) => count + 1)
      } else {
        scoreRef.current?.markOk()
        const newIndex = engine.state.currentIndex
        if (newIndex > previousIndexRef.current) {
          scoreRef.current?.next()
          previousIndexRef.current = newIndex
        }
      }
      setEngineState(engine.state)
    })
  }, [onNoteEvent])

  const handleReady = (osmd: OpenSheetMusicDisplay) => {
    const events = extractExpectedEvents(osmd)
    setTotalEvents(events.length)
    waitEngineRef.current = new WaitEngine(events)
    previousIndexRef.current = 0
    setEngineState(waitEngineRef.current.state)
  }

  if (!musicXml) {
    return <p>Loading score...</p>
  }

  const displayedIndex = Math.min((engineState?.currentIndex ?? 0) + 1, totalEvents)

  return (
    <div>
      <h1>Piano Trainer -- Wait Mode spike</h1>
      <MidiDevice
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelect={selectDevice}
        isSupported={isSupported}
        error={error}
      />
      <p>
        Event {displayedIndex} / {totalEvents}
        {engineState?.completed ? ' -- Done!' : ''} -- Errors: {errorCount}
      </p>
      <PianoScore ref={scoreRef} musicXml={musicXml} onReady={handleReady} />
    </div>
  )
}
