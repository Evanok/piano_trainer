import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { Note } from 'opensheetmusicdisplay'
import { noteToMidi } from '../engine/ScoreParser'

const CORRECT_COLOR = '#22c55e'
const ERROR_COLOR = '#ef4444'
const DEFAULT_COLOR = '#000000'

export interface PianoScoreHandle {
  next: () => void
  reset: () => void
  syncNotes: (heldPitches: number[]) => void
  getCurrentMeasure: () => number
  setZoom: (value: number) => void
  goToEventIndex: (targetIndex: number) => void
}

interface PianoScoreProps {
  source: File
  onReady?: (osmd: OpenSheetMusicDisplay) => void
  onError?: (message: string) => void
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

// Colors every given note, using the fast path where possible and batching a
// single osmd.render() at the end only if some notes needed the fallback.
function colorNotes(osmd: OpenSheetMusicDisplay, assignments: Array<[Note, string]>): void {
  let needsRender = false
  for (const [note, color] of assignments) {
    if (!tryColorNoteFast(osmd, note, color)) {
      note.NoteheadColor = color
      needsRender = true
    }
  }
  if (needsRender) {
    osmd.render()
    osmd.cursor.show()
  }
}

export const PianoScore = forwardRef<PianoScoreHandle, PianoScoreProps>(function PianoScore(
  { source, onReady, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
    })
    osmdRef.current = osmd
    let cancelled = false

    osmd
      .load(source)
      .then(() => {
        if (cancelled) {
          return
        }
        osmd.render()
        osmd.cursor.show()
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
        colorNotes(
          osmd,
          osmd.cursor.NotesUnderCursor().map((note) => [note, DEFAULT_COLOR]),
        )
        osmd.cursor.next()
        // Nothing is held yet for the new position -- mark all its notes as
        // still needed (red) right away, rather than waiting for a mistake.
        colorNotes(
          osmd,
          osmd.cursor
            .NotesUnderCursor()
            .filter((n) => !n.isRest())
            .map((note) => [note, ERROR_COLOR]),
        )
        osmd.cursor.cursorElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      },
      reset: () => osmdRef.current?.cursor.reset(),
      syncNotes: (heldPitches: number[]) => {
        const osmd = osmdRef.current
        if (!osmd) {
          return
        }
        // Always recompute every note's color from the engine's actual held
        // state, rather than patching colors incrementally: correctly-held
        // notes are green, everything else still needed is red, unconditionally.
        colorNotes(
          osmd,
          osmd.cursor
            .NotesUnderCursor()
            .filter((n) => !n.isRest())
            .map((note) => [note, heldPitches.includes(noteToMidi(note)) ? CORRECT_COLOR : ERROR_COLOR]),
        )
      },
      getCurrentMeasure: () => (osmdRef.current?.cursor.Iterator.CurrentMeasureIndex ?? 0) + 1,
      goToEventIndex: (targetIndex: number) => {
        const osmd = osmdRef.current
        if (!osmd) {
          return
        }
        colorNotes(
          osmd,
          osmd.cursor.NotesUnderCursor().map((note) => [note, DEFAULT_COLOR]),
        )
        osmd.cursor.reset()
        let count = 0
        while (!osmd.cursor.Iterator.EndReached) {
          const notes = osmd.cursor.NotesUnderCursor().filter((n) => !n.isRest())
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
          osmd.cursor
            .NotesUnderCursor()
            .filter((n) => !n.isRest())
            .map((note) => [note, ERROR_COLOR]),
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
      },
    }),
    [],
  )

  return (
    <div
      ref={containerRef}
      className="h-[60vh] overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    />
  )
})
