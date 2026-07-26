import type { Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { ExpectedEvent } from '../types/score'

// OSMD's Note.halfTone uses its own internal octave convention (offset by
// Pitch.OctaveXmlDifference = 3 from the MusicXML octave). +12 converts it to
// the standard MIDI note number (e.g. middle C / C4 -> 60).
export function noteToMidi(note: { halfTone: number }): number {
  return note.halfTone + 12
}

// A tied note (e.g. a whole note held across a barline) is the same sustained
// pitch continuing, not a new attack -- it shouldn't require pressing the key
// again. Only the tie's starting note is a real, required event.
export function isTieContinuation(note: Note): boolean {
  const tie = note.NoteTie
  return !!tie && tie.StartNote !== note
}

// Measure numbers (1-based, matching ExpectedEvent.measureNumber) that are
// known to start a new musical section: either it carries a rehearsal mark
// (e.g. "A", "B", "Chorus"), or the previous measure ends on a double/final
// barline. Used by sections.ts to snap a fixed-size training-mode boundary
// onto an actual phrase break instead of cutting mid-phrase. `rehearsalExpression`
// and `endingBarStyleXml` aren't part of OSMD's public type exports, hence the
// untyped access here -- same pattern as tryColorNoteFast's VexFlow internals
// in PianoScore.tsx.
export function extractNaturalBreakMeasures(osmd: OpenSheetMusicDisplay): Set<number> {
  const breaks = new Set<number>()
  const sourceMeasures = osmd.Sheet?.SourceMeasures ?? []
  sourceMeasures.forEach((measure, i) => {
    const measureNumber = i + 1
    if (measure.rehearsalExpression) {
      breaks.add(measureNumber)
    }
    if (measure.endingBarStyleXml === 'light-light' || measure.endingBarStyleXml === 'light-heavy') {
      breaks.add(measureNumber + 1)
    }
  })
  return breaks
}

export function extractExpectedEvents(osmd: OpenSheetMusicDisplay): ExpectedEvent[] {
  const events: ExpectedEvent[] = []
  const cursor = osmd.cursor
  cursor.reset()

  let index = 0
  while (!cursor.Iterator.EndReached) {
    const notes = cursor.NotesUnderCursor().filter((note) => !note.isRest() && !isTieContinuation(note))
    if (notes.length > 0) {
      const pitches = notes.map(noteToMidi)
      const measureNumber = cursor.Iterator.CurrentMeasureIndex + 1
      events.push({ index, pitches, measureNumber })
      index += 1
    }
    cursor.next()
  }

  cursor.reset()
  return events
}
