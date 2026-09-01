import type { Instrument, Note, OpenSheetMusicDisplay, Staff } from 'opensheetmusicdisplay'
import type { HandMode } from '../types/practice'
import type { ExpectedEvent, NoteFinger, NoteHand } from '../types/score'

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
 * The finger the score names for a note, or null when it names none.
 *
 * OSMD fills `Note.Fingering` at parse time from
 * `<notations><technical><fingering>`, so this reads the file's own answer and
 * never computes one: a suggested fingering is an editorial decision, and one
 * invented under the player's hand would be worse than the blank they get now.
 *
 * A label holding SEVERAL fingers ("43", "4-3", "1-2" -- one element whose text
 * is two digits, not two elements) yields its FIRST one. Such a label is a
 * substitution (strike with 4, swap to 3 while holding the key) or an
 * editorial alternative, and under both readings the first digit is the finger
 * that actually presses the key -- which is the only question a highlighted
 * key asks. So there is nothing to guess at here, unlike the values below.
 *
 * Everything else is dropped: circled digits (~1% of the fingerings in the
 * local corpus), parenthesised alternatives like "(4-5)", outright prose like
 * "etc.". The circled form in particular means different things in different
 * editions -- an alternative, a substitution, the other hand -- so it names no
 * striking finger to fall back on the way "43" does.
 *
 * Structurally typed, not `Note`, so it is unit-testable without a loaded OSMD
 * -- same reason selectHandStaff is generic.
 */
const FINGER_PATTERN = /^[1-5](?:[-\u2013/_ ]?[1-5])*$/

export function noteFinger(note: { Fingering?: { value?: string } | null }): NoteFinger | null {
  const value = note.Fingering?.value?.trim()
  if (!value || !FINGER_PATTERN.test(value)) {
    return null
  }
  return Number(value[0]) as NoteFinger
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
  const staves = selectHandStaves(parts)
  return staves && staves[handMode]
}

/**
 * The same pairing rules as selectHandStaff, but returning both staves at once
 * rather than the one a hand mode requires -- which is what labelling each
 * required note with the hand it belongs to needs (VirtualKeyboard shows the
 * hand as a second visual channel next to the note's state colour). Undefined
 * for any layout without an unambiguous pair of hands, so a caller that cannot
 * tell the hands apart says nothing instead of guessing.
 */
export function selectHandStaves<S>(
  parts: Array<{ name: string | null; staves: S[] }>,
): { right: S; left: S } | undefined {
  const named = parts.flatMap((part) => part.staves.map((staff) => ({ staff, name: part.name ?? '' })))
  if (named.length !== 2) {
    return undefined
  }
  const ordered = /left.?hand/i.test(named[0].name) && !/left.?hand/i.test(named[1].name) ? [named[1], named[0]] : named
  return { right: ordered[0].staff, left: ordered[1].staff }
}

function handParts(osmd: OpenSheetMusicDisplay): Array<{ name: string | null; staves: Staff[] }> {
  return playableInstruments(osmd).map((instrument) => ({ name: instrument.Name ?? null, staves: instrument.Staves }))
}

function targetStaffForHand(osmd: OpenSheetMusicDisplay, handMode: HandMode): Staff | undefined {
  return selectHandStaff(handParts(osmd), handMode)
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
  // Resolved once for the whole walk rather than per cursor position: the
  // staves belong to the loaded score, not to where the cursor happens to be.
  const handStaves = selectHandStaves(handParts(osmd))
  cursor.reset()

  let index = 0
  while (!cursor.Iterator.EndReached) {
    const notes = requiredNotesUnderCursor(osmd, handMode)
    if (notes.length > 0) {
      const pitches = notes.map(noteToMidi)
      const hands = notes.map((note): NoteHand | null => {
        if (!handStaves) return null
        if (note.ParentStaff === handStaves.right) return 'right'
        if (note.ParentStaff === handStaves.left) return 'left'
        return null
      })
      const fingers = notes.map(noteFinger)
      const measureNumber = cursor.Iterator.CurrentMeasureIndex + 1
      events.push({ index, pitches, measureNumber, hands, fingers })
      index += 1
    }
    cursor.next()
  }

  cursor.reset()
  return events
}
