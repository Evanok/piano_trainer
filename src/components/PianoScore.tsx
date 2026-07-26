import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { Cursor, Note } from 'opensheetmusicdisplay'
import { isTieContinuation, noteToMidi } from '../engine/ScoreParser'

const CORRECT_COLOR = '#22c55e'
const URGENT_COLOR = '#ef4444'
const NEUTRAL_COLOR = '#eab308'
const DEFAULT_COLOR = '#000000'

export interface PianoScoreHandle {
  next: () => void
  reset: () => void
  syncNotes: (heldPitches: number[], urgent: boolean) => void
  getCurrentMeasure: () => number
  setZoom: (value: number) => void
  goToEventIndex: (targetIndex: number) => void
}

interface PianoScoreProps {
  source: File
  onReady?: (osmd: OpenSheetMusicDisplay) => void
  onError?: (message: string) => void
}

// A cursor position only counts as a real WaitEngine event if it has at least
// one note that isn't a rest or a tied-note continuation (see ScoreParser's
// extractExpectedEvents, which this must stay in sync with).
function requiredNotesUnderCursor(cursor: Cursor): Note[] {
  return cursor.NotesUnderCursor().filter((note) => !note.isRest() && !isTieContinuation(note))
}

// A chord's notes all share one VexFlow StaveNote SVG group, so
// GraphicalNote.setColor() (and getNoteheadSVGs()) would color every notehead
// in the chord, not just this pitch's. vfnoteIndex is this note's position
// within that shared group -- picking that specific notehead element keeps
// per-note coloring correct while still avoiding a full osmd.render() (which
// took ~370ms on a large real score, making every keystroke feel slow).
interface VexFlowNoteInternals {
  vfnoteIndex: number
  getNoteheadSVGs(): SVGElement[]
}

// Tries the fast direct-SVG path; returns false if this note has no usable
// graphical reference yet (seen on some real-world scores, e.g. tied notes
// spanning multiple instruments), so the caller can fall back to the slower
// but always-correct data-model + render() path for just those notes.
function tryColorNoteFast(osmd: OpenSheetMusicDisplay, note: Note, color: string): boolean {
  const gNote = osmd.EngravingRules.GNote(note) as unknown as VexFlowNoteInternals | undefined
  const noteheads = gNote?.getNoteheadSVGs()
  const target = noteheads?.[gNote?.vfnoteIndex ?? -1] ?? noteheads?.[0]
  if (!target) {
    return false
  }
  // The notehead group's own fill is only a fallback -- its child path(s) carry
  // their own explicit fill that overrides it in SVG rendering, so both need
  // to be set for the color change to actually show up on screen.
  target.setAttribute('fill', color)
  for (const child of target.children) {
    child.setAttribute('fill', color)
  }
  return true
}

export const PianoScore = forwardRef<PianoScoreHandle, PianoScoreProps>(function PianoScore(
  { source, onReady, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  // Tracks every note's last-assigned color so it can be reapplied after any
  // full osmd.render() (zoom, or the rare fast-path-fallback) -- a fresh
  // render() regenerates the SVG from scratch (plain black noteheads), and
  // OSMD's own Note.NoteheadColor-during-render mechanism turned out to crash
  // on this app's real-world scores (a library bug, not ours), so colors are
  // only ever reproduced by re-running the direct-SVG fast path afterwards.
  const noteColorsRef = useRef<Map<Note, string>>(new Map())

  // Colors every given note via the fast path, remembering each choice so it
  // survives a future full render(). Falls back to Note.NoteheadColor + a
  // single batched render() only for the rare note the fast path can't reach.
  const colorNotes = (osmd: OpenSheetMusicDisplay, assignments: Array<[Note, string]>) => {
    let needsRender = false
    for (const [note, color] of assignments) {
      noteColorsRef.current.set(note, color)
      if (!tryColorNoteFast(osmd, note, color)) {
        note.NoteheadColor = color
        needsRender = true
      }
    }
    if (needsRender) {
      osmd.render()
      osmd.cursor.show()
      reapplyColors(osmd)
    }
  }

  const reapplyColors = (osmd: OpenSheetMusicDisplay) => {
    for (const [note, color] of noteColorsRef.current) {
      tryColorNoteFast(osmd, note, color)
    }
  }

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
    })
    osmdRef.current = osmd
    noteColorsRef.current = new Map()
    let cancelled = false

    osmd
      .load(source)
      .then(() => {
        if (cancelled) {
          return
        }
        osmd.render()
        osmd.cursor.show()
        // We highlight the current note(s) directly via colorNotes() instead --
        // the cursor's own default rendering (a thin bar) was confusing next to
        // that, so keep it in the layout (needed for scrollIntoView) but invisible.
        osmd.cursor.cursorElement.style.opacity = '0'
        onReady?.(osmd)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        onError?.('This file could not be read as MusicXML. Please check the file and try again.')
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  useImperativeHandle(
    ref,
    () => ({
      next: () => {
        const osmd = osmdRef.current
        if (!osmd) {
          return
        }
        // next() is only ever called once the current event is fully correct --
        // paint it green (and leave it that way permanently, as a played trail)
        // before moving on.
        colorNotes(
          osmd,
          requiredNotesUnderCursor(osmd.cursor).map((note) => [note, CORRECT_COLOR]),
        )
        osmd.cursor.next()
        // Skip rest-only and tie-continuation-only positions -- extractExpectedEvents
        // does the same, so the cursor must land on the same positions it counted as
        // real events, or the cursor and the WaitEngine's event index fall out of sync.
        while (!osmd.cursor.Iterator.EndReached && requiredNotesUnderCursor(osmd.cursor).length === 0) {
          osmd.cursor.next()
        }
        // The new position hasn't been attempted yet -- neutral, not alarming.
        colorNotes(
          osmd,
          requiredNotesUnderCursor(osmd.cursor).map((note) => [note, NEUTRAL_COLOR]),
        )
        osmd.cursor.cursorElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      },
      reset: () => osmdRef.current?.cursor.reset(),
      syncNotes: (heldPitches: number[], urgent: boolean) => {
        const osmd = osmdRef.current
        if (!osmd) {
          return
        }
        // Always recompute every note's color from the engine's actual held
        // state, rather than patching colors incrementally: correctly-held
        // notes are green; everything else is red while `urgent` (right after
        // any attempt) and decays to neutral yellow once the chord tolerance
        // window elapses with no further input (see Practice.tsx's decay timer).
        colorNotes(
          osmd,
          requiredNotesUnderCursor(osmd.cursor).map((note) => [
            note,
            heldPitches.includes(noteToMidi(note)) ? CORRECT_COLOR : urgent ? URGENT_COLOR : NEUTRAL_COLOR,
          ]),
        )
      },
      getCurrentMeasure: () => (osmdRef.current?.cursor.Iterator.CurrentMeasureIndex ?? 0) + 1,
      goToEventIndex: (targetIndex: number) => {
        const osmd = osmdRef.current
        if (!osmd) {
          return
        }
        // A jump (in either direction) can leave positions colored by earlier
        // attempts (errors, partial chord progress, completed-and-green) that
        // would otherwise stay stuck forever -- clear every position in the
        // whole piece back to plain, uncolored notes, not just the ones
        // between the old and new cursor position. Only the target position
        // (below) gets the "current" yellow -- everything else should look
        // untouched, not all yellow.
        osmd.cursor.reset()
        while (!osmd.cursor.Iterator.EndReached) {
          colorNotes(
            osmd,
            osmd.cursor.NotesUnderCursor().map((note) => [note, DEFAULT_COLOR]),
          )
          osmd.cursor.next()
        }

        osmd.cursor.reset()
        let count = 0
        while (!osmd.cursor.Iterator.EndReached) {
          const notes = requiredNotesUnderCursor(osmd.cursor)
          if (notes.length > 0) {
            if (count === targetIndex) {
              break
            }
            count += 1
          }
          osmd.cursor.next()
        }
        colorNotes(
          osmd,
          requiredNotesUnderCursor(osmd.cursor).map((note) => [note, NEUTRAL_COLOR]),
        )
        osmd.cursor.show()
        osmd.cursor.cursorElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      },
      setZoom: (value: number) => {
        const osmd = osmdRef.current
        if (!osmd) {
          return
        }
        osmd.Zoom = value
        osmd.render()
        osmd.cursor.show()
        reapplyColors(osmd)
      },
    }),
    [],
  )

  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    />
  )
})
