import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ExpectedEvent } from '../types/score'

// OSMD's Note.halfTone uses its own internal octave convention (offset by
// Pitch.OctaveXmlDifference = 3 from the MusicXML octave). +12 converts it to
// the standard MIDI note number (e.g. middle C / C4 -> 60).
function noteToMidi(note: { halfTone: number }): number {
  return note.halfTone + 12
}

export function extractExpectedEvents(osmd: OpenSheetMusicDisplay): ExpectedEvent[] {
  const events: ExpectedEvent[] = []
  const cursor = osmd.cursor
  cursor.reset()

  let index = 0
  while (!cursor.Iterator.EndReached) {
    const notes = cursor.NotesUnderCursor().filter((note) => !note.isRest())
    if (notes.length > 0) {
      const pitches = notes.map(noteToMidi)
      events.push({ index, pitches })
      index += 1
    }
    cursor.next()
  }

  cursor.reset()
  return events
}
