import type { Instrument, Note, OpenSheetMusicDisplay, Staff } from 'opensheetmusicdisplay'
import type { HandMode } from '../types/practice'
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

// Some "piano/vocal" sheet music editions add a separate vocal melody staff
// above the actual piano part, for a singer to follow -- left unfiltered, its
// notes would silently join every expected chord alongside the real piano
// notes, requiring the player to also play a note meant to be sung.
//
// Matched by NAME, not by Instrument.HasLyrics -- confirmed against a real
// downloaded piano/vocal score that OSMD's HasLyrics is unreliable per
// instrument (it reported true for the Piano part too, not just the Vocal
// one, so filtering "instruments without lyrics" found zero candidates and
// silently filtered nothing). Only narrows down to one instrument when
// exactly one name match exists: for an ordinary single-instrument piano
// score (the common case, including one that already spans two staves --
// both belong to the same Instrument) named e.g. "Piano" this is a no-op;
// for a score where nothing matches (unlabeled instrument, or a name in
// another convention) or more than one part matches, there's no unambiguous
// single "the piano part" to pick, so it falls back to every note under the
// cursor, same as before this existed.
const PIANO_INSTRUMENT_NAME_PATTERN = /piano|klavier|keyboard/i

export function playableInstrument(osmd: OpenSheetMusicDisplay): Instrument | undefined {
  const instruments = osmd.Sheet?.Instruments ?? []
  const pianoInstruments = instruments.filter((instrument) => PIANO_INSTRUMENT_NAME_PATTERN.test(instrument.Name ?? ''))
  return pianoInstruments.length === 1 ? pianoInstruments[0] : undefined
}

/**
 * Every instrument whose notes count as the player's own -- the piano-named
 * ones, or all of them when no name matches (an unlabeled part, or a naming
 * convention this doesn't know). Unlike playableInstrument above, several is a
 * normal answer: a score can split the hands into two piano parts, and both are
 * the player's.
 */
function playableInstruments(osmd: OpenSheetMusicDisplay): Instrument[] {
  const instruments = osmd.Sheet?.Instruments ?? []
  const pianoInstruments = instruments.filter((instrument) => PIANO_INSTRUMENT_NAME_PATTERN.test(instrument.Name ?? ''))
  return pianoInstruments.length > 0 ? pianoInstruments : instruments
}

/**
 * Picks the staff a hand mode requires, out of the score's playable staves in
 * top-to-bottom order (top = right hand, bottom = left hand).
 *
 * Generic over the staff type so the selection rules can be unit-tested without
 * a loaded OSMD instance -- see ScoreParser.test.ts.
 *
 * Two real-world layouts both have to work here, and only the first one used to:
 *  - ONE part with two staves (`<staves>2</staves>`, `<staff>1|2</staff>` per
 *    note) -- the ordinary grand staff, and what the generated exercises emit.
 *  - TWO single-staff parts, e.g. "Piano, Right Hand" and "Piano, Left Hand"
 *    (seen in a real downloaded score, which carries no `<staff>` element at
 *    all). Looking for two staves *inside one instrument* found none here, so
 *    hand mode silently required both hands forever.
 *
 * A part named "... left hand" pins itself to the left, in case a file ever
 * lists the hands bottom-first; otherwise score order alone decides.
 *
 * Anything other than exactly two playable staves (a single-staff score, an
 * organ's three, a four-hands arrangement) has no unambiguous "the two hands",
 * so it yields undefined: every note stays required, same as 'both', rather
 * than guessing and silently zeroing out events.
 */
export function selectHandStaff<S>(
  parts: Array<{ name: string | null; staves: S[] }>,
  handMode: HandMode,
): S | undefined {
  if (handMode === 'both') {
    return undefined
  }
  const named = parts.flatMap((part) => part.staves.map((staff) => ({ staff, name: part.name ?? '' })))
  if (named.length !== 2) {
    return undefined
  }
  const ordered = /left.?hand/i.test(named[0].name) && !/left.?hand/i.test(named[1].name) ? [named[1], named[0]] : named
  return (handMode === 'right' ? ordered[0] : ordered[1]).staff
}

function targetStaffForHand(osmd: OpenSheetMusicDisplay, handMode: HandMode): Staff | undefined {
  return selectHandStaff(
    playableInstruments(osmd).map((instrument) => ({ name: instrument.Name ?? null, staves: instrument.Staves })),
    handMode,
  )
}

// The single source of truth for "which notes under the cursor actually
// require a keypress right now" -- extractExpectedEvents' initial walk and
// PianoScore's live cursor-stepping (next()/goToEventIndex()/syncNotes())
// both call this, so the two can never drift out of the rest/tie/hand
// filtering that keeps their indices in sync (see extractExpectedEvents'
// own comment on why that matters).
export function requiredNotesUnderCursor(osmd: OpenSheetMusicDisplay, handMode: HandMode = 'both'): Note[] {
  const instrument = playableInstrument(osmd)
  const targetStaff = targetStaffForHand(osmd, handMode)
  return osmd.cursor
    .NotesUnderCursor(instrument)
    .filter((note) => !note.isRest() && !isTieContinuation(note))
    .filter((note) => !targetStaff || note.ParentStaff === targetStaff)
}

export function extractExpectedEvents(osmd: OpenSheetMusicDisplay, handMode: HandMode = 'both'): ExpectedEvent[] {
  const events: ExpectedEvent[] = []
  const cursor = osmd.cursor
  cursor.reset()

  let index = 0
  while (!cursor.Iterator.EndReached) {
    const notes = requiredNotesUnderCursor(osmd, handMode)
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
