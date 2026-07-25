import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ExpectedEvent } from '../types/score'

interface OsmdPitch {
  FundamentalNote: number
  Octave: number
  AccidentalHalfTones: number
}

function pitchToMidi(pitch: OsmdPitch): number {
  return (pitch.Octave + 1) * 12 + pitch.FundamentalNote + pitch.AccidentalHalfTones
}

export function extractExpectedEvents(osmd: OpenSheetMusicDisplay): ExpectedEvent[] {
  const events: ExpectedEvent[] = []
  const cursor = osmd.cursor
  cursor.reset()

  let index = 0
  while (!cursor.Iterator.EndReached) {
    const notes = cursor.NotesUnderCursor().filter((note) => !note.isRest())
    if (notes.length > 0) {
      const pitches = notes.map((note) => pitchToMidi(note.Pitch))
      events.push({ index, pitches })
      index += 1
    }
    cursor.next()
  }

  cursor.reset()
  return events
}
