import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

import { drawnBox, staffViewBox } from './readingStaffViewport'

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

function applyStaffViewport(osmd: OpenSheetMusicDisplay | null, container: HTMLDivElement | null): void {
  const svg = container?.querySelector('svg')
  if (!container || !svg) {
    return
  }
  const viewBox = staffViewBox(osmd, drawnBox(svg))
  if (!viewBox) {
    return
  }
  svg.setAttribute('viewBox', viewBox)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  // Explicit pixels, not percentages: see readingStaffViewport.ts.
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
