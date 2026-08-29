import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

/**
 * Draws ONE measure of a generated reading round at a time.
 *
 * The whole round is a single MusicXML score with one note per measure, loaded
 * once into one OSMD instance; moving to the next question only changes
 * MinMeasureToDrawIndex/MaxMeasureToDrawIndex and re-renders, which is the same
 * crop the section practice modes use. One OSMD instance per question would be
 * far too heavy for a rapid-fire quiz, and a hand-drawn SVG staff would be a
 * second notation renderer to keep in step with the practice screen's engraving
 * (and would need the Bravura glyphs for the clefs).
 *
 * There is no cursor and no note coloring here: the quiz answers with buttons,
 * not with the keyboard, so nothing on the staff ever changes state.
 */

export interface ReadingStaffHandle {
  showMeasure: (measureNumber: number) => void
}

interface ReadingStaffProps {
  source: File
  onReady?: () => void
  onError?: (message: string) => void
}

/**
 * The viewport is the union of the staffline's own box (from OSMD's graphical
 * model, which does not depend on what the measure contains) and the box of
 * what was actually drawn, plus a little air, applied as the SVG's viewBox.
 *
 * Three things went wrong before this shape, all worth remembering:
 *  - OSMD renders a whole page into that SVG and puts the cropped measure in
 *    its top left corner, so left alone the staff occupies a tenth of the
 *    screen whatever the container's size.
 *  - Sizing the SVG with width/height 100% does nothing: OSMD wraps it in a div
 *    it sizes itself, so the percentages resolve against nothing and the SVG
 *    keeps its page-sized layout box. It has to be given explicit pixels.
 *  - The staffline's model box is NOT the five lines centred on their middle
 *    (it covers the staffline's whole region), so treating it as such and
 *    centring a window on it cut the top of the staff off. Uniting it with the
 *    drawn content's box makes clipping impossible whatever it turns out to be.
 *
 * The union still holds the scale roughly steady from question to question,
 * since the staffline's box dominates it and does not follow the notes.
 */
const VIEW_VERTICAL_PADDING_FRACTION = 0.12
const VIEW_HORIZONTAL_PADDING_FRACTION = 0.05

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function boxOf(element: Element | null): Box | null {
  if (!element) {
    return null
  }
  try {
    const box = (element as SVGGraphicsElement).getBBox()
    return box.width > 0 && box.height > 0 ? box : null
  } catch {
    // getBBox throws on an element that is not rendered yet.
    return null
  }
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) {
    return a ?? b
  }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

// OSMD lays a page out in its own abstract units, rendered at 10px per unit
// before the zoom multiplier, and the SVG's user coordinates are those pixels.
const OSMD_PIXELS_PER_UNIT = 10

function modelStaffBox(osmd: OpenSheetMusicDisplay | null): Box | null {
  const shape = osmd?.GraphicSheet?.MusicPages?.[0]?.MusicSystems?.[0]?.StaffLines?.[0]?.PositionAndShape
  if (!shape) {
    return null
  }
  const scale = OSMD_PIXELS_PER_UNIT * (osmd?.Zoom ?? 1)
  const box = {
    x: shape.AbsolutePosition.x * scale,
    y: shape.AbsolutePosition.y * scale,
    width: shape.Size.width * scale,
    height: shape.Size.height * scale,
  }
  return box.width > 0 && box.height > 0 ? box : null
}

function applyStaffViewport(osmd: OpenSheetMusicDisplay | null, container: HTMLDivElement | null): void {
  const svg = container?.querySelector('svg')
  if (!container || !svg) {
    return
  }
  const drawn = boxOf(svg.querySelector('g.vf-measure')) ?? boxOf(svg)
  const box = union(modelStaffBox(osmd), drawn)
  if (!box) {
    return
  }
  const padX = box.width * VIEW_HORIZONTAL_PADDING_FRACTION
  const padY = box.height * VIEW_VERTICAL_PADDING_FRACTION
  svg.setAttribute(
    'viewBox',
    `${box.x - padX} ${box.y - padY} ${box.width + padX * 2} ${box.height + padY * 2}`,
  )
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  // Explicit pixels, not percentages: see the note above.
  svg.setAttribute('width', String(container.clientWidth))
  svg.setAttribute('height', String(container.clientHeight))
  const wrapper = svg.parentElement
  if (wrapper) {
    wrapper.style.width = '100%'
    wrapper.style.height = '100%'
  }
}

export const ReadingStaff = forwardRef<ReadingStaffHandle, ReadingStaffProps>(function ReadingStaff(
  { source, onReady, onError },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null)
  const hasLoadedRef = useRef(false)

  const cropTo = (osmd: OpenSheetMusicDisplay, measureNumber: number) => {
    osmd.EngravingRules.MinMeasureToDrawIndex = measureNumber - 1
    osmd.EngravingRules.MaxMeasureToDrawIndex = measureNumber - 1
    osmd.updateGraphic()
    osmd.render()
    applyStaffViewport(osmd, containerRef.current)
  }

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    // OSMD does not clear a container it did not create itself, so a new round
    // would otherwise leave the previous round's SVG behind.
    containerRef.current.replaceChildren()
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
      autoResize: true,
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      // A measure number over every question would be a distraction, and the
      // round's own progress is already in the header.
      drawMeasureNumbers: false,
    })
    osmdRef.current = osmd
    hasLoadedRef.current = false
    let cancelled = false

    osmd
      .load(source)
      .then(() => {
        if (cancelled) {
          return
        }
        hasLoadedRef.current = true
        // One full render before the first crop: updateGraphic() rebuilds a
        // graphical model, and OSMD expects one to exist already.
        osmd.render()
        cropTo(osmd, 1)
        onReady?.()
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError?.(error instanceof Error ? error.message : 'Could not render the staff')
        }
      })

    return () => {
      cancelled = true
      osmdRef.current = null
      hasLoadedRef.current = false
    }
    // onReady/onError are called once per load; re-running on their identity
    // would reload the score on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // A rotation or a resized window makes OSMD re-render on its own (autoResize),
  // which rewrites the SVG's size attributes and drops the viewBox with them.
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => applyStaffViewport(osmdRef.current, containerRef.current))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useImperativeHandle(ref, () => ({
    showMeasure: (measureNumber: number) => {
      const osmd = osmdRef.current
      if (!osmd || !hasLoadedRef.current) {
        return
      }
      cropTo(osmd, measureNumber)
    },
  }))

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
})
