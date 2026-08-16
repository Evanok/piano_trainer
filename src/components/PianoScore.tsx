import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { Note } from 'opensheetmusicdisplay'
import { noteToMidi, playableInstrument, requiredNotesUnderCursor } from '../engine/ScoreParser'
import type { HandMode } from '../types/practice'

const CORRECT_COLOR = '#22c55e'
const NEUTRAL_COLOR = '#eab308'
const DEFAULT_COLOR = '#000000'

// Scroll mode: how many measures should fit across the container's width --
// the zoom level is derived from this, not the other way around, so the
// player always sees a consistent amount of "road ahead" regardless of the
// piece's note density. Cursor look-ahead: the cursor is kept at this
// fraction of the container width from the left edge (not centered and
// never let drift to the right edge) so upcoming measures are always
// visible to anticipate, per the user's explicit ask.
const SCROLL_MODE_TARGET_VISIBLE_MEASURES = 4.5
const SCROLL_MODE_LOOKAHEAD_FRACTION = 0.3
// OSMD caps a single horizontal staffline's total width at EngravingRules.
// SheetMaximumWidth (default 32767, a leftover Canvas-backend limit -- SVG has
// none) and silently squishes measures toward zero width past it instead of
// erroring. A real score zoomed in to hit ~4-5 visible measures easily needs
// more total width than that once spread across 200+ measures, so this must
// be raised before load() (same load-order constraint as RenderSingleHorizontalStaffline).
const SCROLL_MODE_SHEET_MAXIMUM_WIDTH = 300000

export interface PianoScoreHandle {
  next: () => void
  reset: () => void
  syncNotes: (heldPitches: number[]) => void
  getCurrentMeasure: () => number
  setZoom: (value: number) => void
  goToEventIndex: (targetIndex: number) => void
  // Restricts rendering to [startMeasure, endMeasure] (1-based, inclusive,
  // matching ExpectedEvent.measureNumber) -- training mode's "each section is
  // its own isolated score" (no leftover notes from the previous section
  // still visible off to the side). Pass nulls to clear back to the whole piece.
  setSectionBounds: (startMeasure: number | null, endMeasure: number | null) => void
  // Changes which hand's notes are required from this point on, without
  // remounting/reparsing the score -- see the handModeRef comment below for
  // why this must be a synchronous imperative call rather than only a prop.
  setHandMode: (handMode: HandMode) => void
}

export type LayoutMode = 'page' | 'scroll'

interface PianoScoreProps {
  source: File
  layoutMode?: LayoutMode
  handMode?: HandMode
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

// Picks a zoom level for scroll mode instead of leaving the default zoom's
// much narrower measures cramming dozens on screen above a wall of unused
// space below (the single staffline is short at zoom 1). Must run after an
// initial render() at the current zoom, to measure the actual on-screen
// sizes; re-renders once at the computed zoom.
//
// Two constraints, and the smaller (less zoomed-in) of the two wins -- never
// the bigger, or a score whose natural aspect ratio doesn't fit both at once
// would zoom in enough to hit the measure-count target but clip the bottom
// staff out of the container (overflow-y is hidden in scroll mode, so any
// part below the container's height is simply gone, not scrollable):
//  - width: no more than SCROLL_MODE_TARGET_VISIBLE_MEASURES measures should
//    fit across the container's width. Sampled from the first few measures
//    specifically, not a whole-piece average -- the opening is usually less
//    dense than a piece's busiest sections, so an average zoom-fit
//    consistently undershoots and shows more than intended right when the
//    player starts. Measured via one shared left-edge x-position per real
//    measure (a piano score's treble/bass staves each contribute their own
//    SVG group per measure, but share the same x).
//  - height: the single staffline should fill the container's height rather
//    than leaving blank space below it, and never exceed it.
const SCROLL_MODE_SAMPLE_MEASURES = 8

function fitScrollZoom(osmd: OpenSheetMusicDisplay, container: HTMLElement): void {
  const svg = container.querySelector('svg')
  const groups = Array.from(container.querySelectorAll('g.vf-measure'))
  const leftXs = Array.from(new Set(groups.map((g) => Math.round(g.getBoundingClientRect().left)))).sort(
    (a, b) => a - b,
  )
  const sampleCount = Math.min(SCROLL_MODE_SAMPLE_MEASURES, leftXs.length - 1)
  const heightAtCurrentZoom = svg ? parseFloat(svg.getAttribute('height') ?? '0') : 0
  if (sampleCount < 1 || !heightAtCurrentZoom) {
    return
  }
  const sampledWidthAtCurrentZoom = leftXs[sampleCount] - leftXs[0]
  const avgMeasureWidthAtZoom1 = sampledWidthAtCurrentZoom / sampleCount / osmd.Zoom
  const heightAtZoom1 = heightAtCurrentZoom / osmd.Zoom
  const widthBasedZoom = container.clientWidth / SCROLL_MODE_TARGET_VISIBLE_MEASURES / avgMeasureWidthAtZoom1
  const heightBasedZoom = container.clientHeight / heightAtZoom1
  osmd.Zoom = Math.min(Math.max(Math.min(widthBasedZoom, heightBasedZoom), 0.5), 5)
  osmd.render()
}

// Vertically centers the staffline using the WHOLE (uncropped) piece's own
// natural height, not each render's own bounding box -- CSS `items-center`
// alone re-centers per render, and a training-mode section's height varies
// with its own ledger-line extremes (how high/low its notes reach), so
// different sections visibly sat at different heights/sizes switching
// between them. A single shared anchor keeps every section's staff sitting
// at the same vertical position, like a fixed window onto the full page.
function applyStableVerticalOffset(container: HTMLElement, stableHeight: number | null): void {
  const svg = container.querySelector('svg')
  if (!svg || stableHeight === null) {
    return
  }
  svg.style.marginTop = `${Math.max(0, (container.clientHeight - stableHeight) / 2)}px`
}

// Page mode keeps the browser's own scrollIntoView (vertical, "nearest" is
// enough there). Scroll mode drives the container's horizontal scroll
// directly instead of relying on OSMD's own cursor-follow behavior, both to
// avoid the two fighting each other (visibly janky) and to enforce the
// look-ahead position rather than centering or only scrolling once the
// cursor reaches the edge.
function scrollCursorIntoView(osmd: OpenSheetMusicDisplay, container: HTMLElement, mode: LayoutMode): void {
  const cursorElement = osmd.cursor.cursorElement
  if (mode !== 'scroll') {
    cursorElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    return
  }
  // NOT getBoundingClientRect() -- the cursor element has a CSS transition on
  // its position (OSMD animates it moving), so reading its rect right after
  // moving it can capture a mid-animation value instead of the target,
  // sending the container to the wrong place (seen jumping the cursor off
  // the visible area entirely on long jumps). style.left is the same
  // content-space X the transition animates towards, set synchronously.
  const cursorX = parseFloat(cursorElement.style.left)
  if (!Number.isFinite(cursorX)) {
    return
  }
  const targetScrollLeft = Math.max(0, cursorX - container.clientWidth * SCROLL_MODE_LOOKAHEAD_FRACTION)
  container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
}

export const PianoScore = forwardRef<PianoScoreHandle, PianoScoreProps>(function PianoScore(
  { source, layoutMode = 'page', handMode = 'both', onReady, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  // useImperativeHandle below is only ever built once ([] deps, to keep the
  // handle identity stable) -- its closures can't see later renders' props
  // directly, so layoutMode is read through this ref instead.
  const layoutModeRef = useRef<LayoutMode>(layoutMode)
  layoutModeRef.current = layoutMode
  // Same reasoning as layoutModeRef, but ALSO updated imperatively via
  // setHandMode() below: a hand-mode switch must take effect on the very next
  // cursor operation (goToEventIndex, called synchronously by Practice.tsx
  // right after switching), which runs before React re-renders this
  // component with the new prop -- reading only the prop-updated ref here
  // would filter that one call by the stale hand mode.
  const handModeRef = useRef<HandMode>(handMode)
  handModeRef.current = handMode
  // Tracks every note's last-assigned color so it can be reapplied after any
  // full osmd.render() (zoom, or the rare fast-path-fallback) -- a fresh
  // render() regenerates the SVG from scratch (plain black noteheads), and
  // OSMD's own Note.NoteheadColor-during-render mechanism turned out to crash
  // on this app's real-world scores (a library bug, not ours), so colors are
  // only ever reproduced by re-running the direct-SVG fast path afterwards.
  const noteColorsRef = useRef<Map<Note, string>>(new Map())
  // Scroll-mode zoom, computed ONCE from the whole (uncropped) piece right
  // after load and then reused as-is for every training-mode section crop --
  // recomputing per section (sampling only that section's own measures) let
  // denser/sparser sections settle on different zoom levels, so the two
  // staves visibly changed size/position switching between sections. A
  // single shared zoom keeps every section looking like a plain crop of the
  // same page, not a separately laid-out one.
  const stableScrollZoomRef = useRef<number | null>(null)
  // The whole (uncropped) piece's own natural rendered height at that same
  // zoom -- see applyStableVerticalOffset.
  const stableScrollHeightRef = useRef<number | null>(null)
  // osmdRef.current becomes non-null synchronously on construction, well
  // before osmd.load() actually resolves -- calling into OSMD methods that
  // assume a loaded sheet (render(), updateGraphic(), the cursor) in that
  // window crashes deep inside OSMD's internals (seen for real: a
  // mobile-only effect that fires immediately on mount called
  // setSectionBounds before the file had loaded, reading a property of the
  // not-yet-existent GraphicalMusicSheet). Every imperative method below
  // guards on this in addition to `!osmd`.
  const hasLoadedRef = useRef(false)

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
    // A remount (e.g. toggling layoutMode) leaves the previous instance's SVG
    // behind otherwise -- OSMD doesn't clear a container it didn't create itself.
    containerRef.current.replaceChildren()
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
      // "Arranged by ..." / "Composed by ..." credits aren't covered by
      // drawTitle -- left on, they push the whole staffline down, which is
      // especially visible in scroll mode where the staff no longer has a
      // full page of margin to absorb it.
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      // Must be set before load() -- OSMD ignores it if set via setOptions()
      // afterwards. Reusing Wait Mode's own advance/coloring logic unchanged,
      // this only swaps the paginated layout for one continuous staff line
      // (horizontal auto-scroll is handled ourselves, see scrollCursorIntoView).
      renderSingleHorizontalStaffline: layoutMode === 'scroll',
    })
    if (layoutMode === 'scroll') {
      osmd.EngravingRules.SheetMaximumWidth = SCROLL_MODE_SHEET_MAXIMUM_WIDTH
    }
    osmdRef.current = osmd
    noteColorsRef.current = new Map()
    stableScrollZoomRef.current = null
    stableScrollHeightRef.current = null
    hasLoadedRef.current = false
    let cancelled = false

    osmd
      .load(source)
      .then(() => {
        if (cancelled) {
          return
        }
        hasLoadedRef.current = true
        // A malformed score can carry a repeat barline with no matching close
        // (seen in the wild: an opening repeat and a final barline, but no
        // closing repeat in between) -- OSMD's cursor would otherwise loop
        // back through it forever, and since extractExpectedEvents walks this
        // same cursor right after onReady fires below, the event list would
        // never reach a real end either. Ignoring repetitions entirely means
        // a genuinely repeated section is only played once instead of twice,
        // but that trade-off is preferable to a piece that can silently never
        // be completed. Must be set before the first cursor walk, i.e. before
        // onReady (extractExpectedEvents) runs, not just before render().
        osmd.EngravingRules.CursorIgnoreRepetitions = true
        // Same reasoning as playableInstrument (ScoreParser.ts): a "piano/vocal"
        // edition's extra vocal staff isn't just excluded from required notes,
        // it's hidden from the rendering entirely -- there's no reason to show
        // a staff the player was never going to play from. updateGraphic()
        // before this first render() because Instrument.Visible is read from
        // the graphical model, not recomputed by render() on its own (same as
        // setSectionBounds further down, which needs it after changing
        // Min/MaxMeasureToDrawIndex for the same reason).
        const instrument = playableInstrument(osmd)
        if (instrument) {
          for (const candidate of osmd.Sheet?.Instruments ?? []) {
            candidate.Visible = candidate === instrument
          }
          osmd.updateGraphic()
        }
        osmd.render()
        if (layoutMode === 'scroll' && containerRef.current) {
          fitScrollZoom(osmd, containerRef.current)
          stableScrollZoomRef.current = osmd.Zoom
          const svg = containerRef.current.querySelector('svg')
          stableScrollHeightRef.current = svg ? parseFloat(svg.getAttribute('height') ?? '0') : null
          applyStableVerticalOffset(containerRef.current, stableScrollHeightRef.current)
        }
        osmd.cursor.show()
        // We highlight the current note(s) directly via colorNotes() instead --
        // the cursor's own default rendering (a thin bar) was confusing next to
        // that, so keep it in the layout (needed for scrollIntoView) but invisible.
        osmd.cursor.cursorElement.style.opacity = '0'
        // Scrolling is driven entirely by scrollCursorIntoView below -- OSMD's
        // own cursor-follow (auto-centering in scroll mode) would otherwise
        // fire on every cursor.next() too and fight our look-ahead position.
        osmd.cursor.CursorOptions = { ...osmd.cursor.CursorOptions, follow: false }
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
      hasLoadedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, layoutMode])

  useImperativeHandle(
    ref,
    () => ({
      next: () => {
        const osmd = osmdRef.current
        if (!osmd || !hasLoadedRef.current) {
          return
        }
        // next() is only ever called once the current event is fully correct --
        // paint it green (and leave it that way permanently, as a played trail)
        // before moving on.
        colorNotes(
          osmd,
          requiredNotesUnderCursor(osmd, handModeRef.current).map((note) => [note, CORRECT_COLOR]),
        )
        osmd.cursor.next()
        // Skip rest-only and tie-continuation-only positions -- extractExpectedEvents
        // does the same, so the cursor must land on the same positions it counted as
        // real events, or the cursor and the WaitEngine's event index fall out of sync.
        while (!osmd.cursor.Iterator.EndReached && requiredNotesUnderCursor(osmd, handModeRef.current).length === 0) {
          osmd.cursor.next()
        }
        // The new position hasn't been attempted yet -- neutral, not alarming.
        colorNotes(
          osmd,
          requiredNotesUnderCursor(osmd, handModeRef.current).map((note) => [note, NEUTRAL_COLOR]),
        )
        if (containerRef.current) {
          scrollCursorIntoView(osmd, containerRef.current, layoutModeRef.current)
        }
      },
      reset: () => osmdRef.current?.cursor.reset(),
      syncNotes: (heldPitches: number[]) => {
        const osmd = osmdRef.current
        if (!osmd || !hasLoadedRef.current) {
          return
        }
        // Always recompute every note's color from the engine's actual held
        // state, rather than patching colors incrementally: correctly-held
        // notes are green, everything else stays neutral yellow until held.
        // A wrong keypress is shown precisely on the virtual keyboard instead
        // of vaguely reddening every other expected note here.
        colorNotes(
          osmd,
          requiredNotesUnderCursor(osmd, handModeRef.current).map((note) => [
            note,
            heldPitches.includes(noteToMidi(note)) ? CORRECT_COLOR : NEUTRAL_COLOR,
          ]),
        )
      },
      getCurrentMeasure: () => (osmdRef.current?.cursor.Iterator.CurrentMeasureIndex ?? 0) + 1,
      goToEventIndex: (targetIndex: number) => {
        const osmd = osmdRef.current
        if (!osmd || !hasLoadedRef.current) {
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
          const notes = requiredNotesUnderCursor(osmd, handModeRef.current)
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
          requiredNotesUnderCursor(osmd, handModeRef.current).map((note) => [note, NEUTRAL_COLOR]),
        )
        osmd.cursor.show()
        if (containerRef.current) {
          scrollCursorIntoView(osmd, containerRef.current, layoutModeRef.current)
        }
      },
      setZoom: (value: number) => {
        const osmd = osmdRef.current
        if (!osmd || !hasLoadedRef.current) {
          return
        }
        osmd.Zoom = value
        osmd.render()
        osmd.cursor.show()
        reapplyColors(osmd)
      },
      setSectionBounds: (startMeasure: number | null, endMeasure: number | null) => {
        const osmd = osmdRef.current
        if (!osmd || !hasLoadedRef.current) {
          return
        }
        // Direct EngravingRules fields (0-based indices), not
        // setOptions({drawFromMeasureNumber, ...}) -- that does its own
        // measure-NUMBER-to-index conversion (accounting for pickup
        // measures) which doesn't necessarily match ExpectedEvent.measureNumber's
        // own sequential-index scheme, and passing undefined to clear a
        // previously-set bound is a no-op in setOptions (it only ever
        // narrows, never resets), so clearing needs these defaults directly
        // anyway (MinMeasureToDrawIndex 0, MaxMeasureToDrawIndex Number.MAX_VALUE).
        osmd.EngravingRules.MinMeasureToDrawIndex = startMeasure !== null ? startMeasure - 1 : 0
        osmd.EngravingRules.MaxMeasureToDrawIndex = endMeasure !== null ? endMeasure - 1 : Number.MAX_VALUE
        // Reuse the whole-piece zoom computed once at load, rather than
        // re-fitting to just this (cropped) section -- see stableScrollZoomRef.
        if (layoutModeRef.current === 'scroll' && stableScrollZoomRef.current !== null) {
          osmd.Zoom = stableScrollZoomRef.current
        }
        osmd.updateGraphic()
        osmd.render()
        if (layoutModeRef.current === 'scroll' && containerRef.current) {
          applyStableVerticalOffset(containerRef.current, stableScrollHeightRef.current)
        }
        osmd.cursor.show()
        osmd.cursor.cursorElement.style.opacity = '0'
        reapplyColors(osmd)
        // The crop's re-zoom changes the SVG's coordinate space -- the
        // container's scrollLeft from before this call is now meaningless
        // (same pixel offset, different content underneath), so the cursor
        // has to be re-positioned into view under the new scale.
        if (containerRef.current) {
          scrollCursorIntoView(osmd, containerRef.current, layoutModeRef.current)
        }
      },
      setHandMode: (newHandMode: HandMode) => {
        // Plain synchronous ref write -- Practice.tsx calls this immediately
        // before its own goToEventIndex() (recoloring the whole piece from
        // the new hand's required notes), which must see the new hand mode
        // even though React hasn't re-rendered this component with the new
        // prop yet.
        handModeRef.current = newHandMode
      },
    }),
    [],
  )

  return (
    <div
      ref={containerRef}
      className={
        layoutMode === 'scroll'
          ? // No items-center here -- vertical centering is applied manually
            // (applyStableVerticalOffset, via the SVG's own marginTop) using
            // the whole piece's height as a stable anchor, not each render's
            // own bounding box; letting flexbox re-center per render is what
            // caused different training-mode sections to visibly sit at
            // different heights depending on their own ledger-line extremes.
            'min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm'
          : 'min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm'
      }
    />
  )
})
