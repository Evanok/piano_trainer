import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The loop range control of "Scroll loop": which measures of the piece are
 * being drilled, over and over.
 *
 * Three ways to set the same two numbers, because no single one of them is
 * good at everything:
 *  - The BAR shows where the loop sits inside the whole piece and where the
 *    cursor currently is, and lets a handle be dragged to aim quickly. It is
 *    the only control that answers "where am I in this piece", but on a long
 *    piece one measure is a few pixels wide, so it is a coarse tool.
 *  - The two NUMBER fields are exact whatever the piece's length, which is
 *    what dragging cannot be. They are the fallback for "bar 57 to bar 64".
 *  - A and B set a bound to WHERE THE CURSOR ALREADY IS, which is how a
 *    passage actually gets picked in practice: play until it falls apart,
 *    press A, play through it, press B. No number has to be aimed at all, and
 *    it works identically with a finger and with a mouse.
 *
 * Only whole measures, since ExpectedEvent carries no finer position (the same
 * granularity limit measureAtClientPoint documents).
 */

/** Tick labels are thinned until they fit: a 200-measure piece gets a label
 * every 25 measures, not 200 unreadable ones stacked on each other. */
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]
const MIN_TICK_SPACING_PX = 44

interface LoopRangeBarProps {
  totalMeasures: number
  startMeasure: number
  endMeasure: number
  /** Where the cursor is right now: drawn as a playhead, and what A/B use. */
  currentMeasure: number
  onChange: (startMeasure: number, endMeasure: number) => void
  /** Landscape phone: one row, no tick labels, icon-sized buttons. */
  compact?: boolean
}

export function LoopRangeBar({
  totalMeasures,
  startMeasure,
  endMeasure,
  currentMeasure,
  onChange,
  compact = false,
}: LoopRangeBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [trackWidthPx, setTrackWidthPx] = useState(0)
  // The bound being dragged, and its live value: the commit only happens on
  // release, since every commit moves the cursor back to the loop's start and
  // doing that on each pixel of a drag would be unusable.
  const [drag, setDrag] = useState<{ bound: 'start' | 'end'; measure: number } | null>(null)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver((entries) => setTrackWidthPx(entries[0].contentRect.width))
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const total = Math.max(1, totalMeasures)
  const shownStart = drag?.bound === 'start' ? drag.measure : startMeasure
  const shownEnd = drag?.bound === 'end' ? drag.measure : endMeasure
  const isWholePiece = shownStart <= 1 && shownEnd >= total

  const percentAt = (measure: number) => ((measure - 1) / total) * 100

  const measureFromClientX = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return 1
    const rect = track.getBoundingClientRect()
    const fraction = (clientX - rect.left) / Math.max(1, rect.width)
    return Math.min(total, Math.max(1, Math.floor(fraction * total) + 1))
  }

  const startDrag = (bound: 'start' | 'end') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ bound, measure: bound === 'start' ? startMeasure : endMeasure })
  }

  const moveDrag = (bound: 'start' | 'end') => (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.bound !== bound) return
    const measure = measureFromClientX(event.clientX)
    // A bound never crosses the other one: clamping is predictable, swapping
    // mid-drag is not.
    const clamped = bound === 'start' ? Math.min(measure, endMeasure) : Math.max(measure, startMeasure)
    setDrag({ bound, measure: clamped })
  }

  const endDrag = (bound: 'start' | 'end') => (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.bound !== bound) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const measure = drag.measure
    setDrag(null)
    if (bound === 'start' && measure !== startMeasure) {
      onChange(measure, endMeasure)
    } else if (bound === 'end' && measure !== endMeasure) {
      onChange(startMeasure, measure)
    }
  }

  const tickStep = TICK_STEPS.find((step) => (total / step) * MIN_TICK_SPACING_PX <= trackWidthPx) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const ticks: number[] = []
  if (trackWidthPx > 0) {
    for (let measure = 1; measure <= total; measure += tickStep) {
      ticks.push(measure)
    }
  }

  const handle = (bound: 'start' | 'end') => {
    const measure = bound === 'start' ? shownStart : shownEnd
    // The end handle sits on the RIGHT edge of its measure: the loop includes
    // that measure, so its right edge is where the loop actually stops.
    const percent = bound === 'start' ? percentAt(measure) : percentAt(measure) + 100 / total
    return (
      <div
        role="slider"
        aria-label={bound === 'start' ? 'Loop start measure' : 'Loop end measure'}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={measure}
        tabIndex={0}
        onPointerDown={startDrag(bound)}
        onPointerMove={moveDrag(bound)}
        onPointerUp={endDrag(bound)}
        onPointerCancel={endDrag(bound)}
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
          if (delta === 0) return
          event.preventDefault()
          if (bound === 'start') {
            onChange(Math.min(endMeasure, Math.max(1, startMeasure + delta)), endMeasure)
          } else {
            onChange(startMeasure, Math.max(startMeasure, Math.min(total, endMeasure + delta)))
          }
        }}
        className="absolute top-1/2 z-20 h-6 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded border border-indigo-700 bg-white shadow"
        // touchAction none is what makes a finger drag the handle instead of
        // scrolling the page under it.
        style={{ left: `${percent}%`, touchAction: 'none' }}
      >
        <div className="mx-auto h-full w-px bg-indigo-400" />
        {drag?.bound === bound && (
          <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-indigo-700 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow">
            {measure}
          </span>
        )}
      </div>
    )
  }

  const nudge = (bound: 'start' | 'end', delta: number) => () => {
    if (bound === 'start') {
      onChange(Math.min(endMeasure, Math.max(1, startMeasure + delta)), endMeasure)
    } else {
      onChange(startMeasure, Math.max(startMeasure, Math.min(total, endMeasure + delta)))
    }
  }

  // One measure at a time, which is the adjustment that actually comes up:
  // giving yourself a bar of run-up before the hard passage. A and B can only
  // ever narrow the loop (the score is cropped to it, so the cursor can never
  // be outside), so widening lives here and on the bar's handles.
  const stepper = (bound: 'start' | 'end', delta: number) => (
    <button
      type="button"
      onClick={nudge(bound, delta)}
      aria-label={`${delta < 0 ? 'Move' : 'Move'} loop ${bound} ${delta < 0 ? 'earlier' : 'later'} by one measure`}
      className="rounded border border-indigo-300 bg-white px-1.5 py-1 text-xs leading-none text-indigo-700 hover:bg-indigo-100"
    >
      {delta < 0 ? '-' : '+'}
    </button>
  )

  const numberField = (bound: 'start' | 'end') => (
    <input
      type="number"
      min={1}
      max={total}
      value={bound === 'start' ? startMeasure : endMeasure}
      aria-label={bound === 'start' ? 'Loop from measure' : 'Loop to measure'}
      onChange={(event) => {
        const value = Number(event.target.value)
        if (!Number.isFinite(value)) return
        if (bound === 'start') {
          onChange(Math.min(endMeasure, Math.max(1, value)), endMeasure)
        } else {
          onChange(startMeasure, Math.max(startMeasure, Math.min(total, value)))
        }
      }}
      className="w-14 rounded-md border border-indigo-300 bg-white px-1.5 py-1 text-sm text-indigo-900"
    />
  )

  // The handles hang half outside the track at the extremes, so the track gets
  // its own horizontal room rather than colliding with the A/B buttons.
  const bar = (
    <div className={compact ? 'relative mx-2 flex-1' : 'relative w-full px-2'}>
      <div ref={trackRef} className={`relative w-full rounded-full bg-gray-200 ${compact ? 'h-2.5' : 'h-3'}`}>
        <div
          className="absolute inset-y-0 rounded-full bg-indigo-500/70"
          style={{ left: `${percentAt(shownStart)}%`, width: `${percentAt(shownEnd) + 100 / total - percentAt(shownStart)}%` }}
        />
        {/* Where the cursor is right now, so the loop is read against actual
            progress rather than in the abstract. */}
        <div
          className="absolute -top-0.5 bottom-[-2px] w-0.5 rounded bg-gray-900"
          style={{ left: `${percentAt(currentMeasure) + 50 / total}%` }}
        />
        {handle('start')}
        {handle('end')}
      </div>
      {!compact && (
        <div className="relative mt-3 h-3">
          {ticks.map((measure) => (
            <span
              key={measure}
              className="absolute -translate-x-1/2 text-[10px] leading-none text-gray-400"
              style={{ left: `${percentAt(measure) + 50 / total}%` }}
            >
              {measure}
            </span>
          ))}
        </div>
      )}
    </div>
  )

  const setFromCursor = (bound: 'start' | 'end') => () => {
    if (bound === 'start') {
      onChange(Math.min(currentMeasure, endMeasure), endMeasure)
    } else {
      onChange(startMeasure, Math.max(currentMeasure, startMeasure))
    }
  }

  const abButton = (bound: 'start' | 'end') => (
    <button
      type="button"
      onClick={setFromCursor(bound)}
      aria-label={
        bound === 'start'
          ? 'Set loop start to the measure being played'
          : 'Set loop end to the measure being played'
      }
      title={
        bound === 'start'
          ? 'Start the loop at the measure being played'
          : 'End the loop at the measure being played'
      }
      className="shrink-0 rounded-md border border-indigo-300 bg-white px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
    >
      {bound === 'start' ? 'A' : 'B'}
    </button>
  )

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        {abButton('start')}
        {bar}
        {abButton('end')}
        <span className="shrink-0 text-xs font-medium tabular-nums text-indigo-900">
          {isWholePiece ? `1-${total}` : `${shownStart}-${shownEnd}`}
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium">Loop</span>
        <span className="flex items-center gap-1">
          {stepper('start', -1)}
          {numberField('start')}
          {stepper('start', 1)}
        </span>
        <span>to</span>
        <span className="flex items-center gap-1">
          {stepper('end', -1)}
          {numberField('end')}
          {stepper('end', 1)}
        </span>
        <span className="text-indigo-700">of {total}</span>
        {abButton('start')}
        {abButton('end')}
        <span className="text-xs text-indigo-700">
          A and B set a bound to the measure being played (measure {currentMeasure})
        </span>
        <button
          type="button"
          onClick={() => onChange(1, total)}
          disabled={isWholePiece}
          className="ml-auto rounded-md border border-indigo-300 bg-white px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          Whole piece
        </button>
      </div>
      <div className="mt-3">{bar}</div>
    </div>
  )
}
