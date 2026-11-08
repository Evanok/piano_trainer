import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/** A combo that just broke, with an id so two breaks of the same size still animate twice. */
export interface ComboBreak {
  id: number
  value: number
}

interface ComboOverlayProps {
  combo: number
  /** Session best, which rises together with `combo` while a record run is on. */
  best: number
  comboBreak: ComboBreak | null
  compact?: boolean
}

/** Below this a broken combo is not worth a falling number: one or two notes are noise. */
const MIN_BREAK_TO_SHOW = 3
/** A run only announces a new best once there was a real one to beat. */
const MIN_BEST_TO_BEAT = 5
const MILESTONE_EVERY = 10
const BREAK_ANIMATION_MS = 900
/** Sparks thrown out by a milestone, evenly spread around the circle. */
const SPARK_COUNT = 16
/** How long a milestone's hop to a new slot lasts, burst included (index.css, combo-hop). */
const TRAVEL_MS = 1500
/**
 * Where the counter can sit along the top row of the score, as the centre of
 * the block in percent of the score's width: left, centre left, centre,
 * centre right, right. It starts on the right and moves to another slot at
 * every milestone. Always the same row, never down onto the staff: a burst in
 * the middle of the screen, over the notes being read, broke concentration.
 */
const SLOTS_PERCENT = [10, 30, 50, 70, 90]
const START_SLOT = SLOTS_PERCENT.length - 1

/** Any slot but the current one, so a milestone always visibly moves. */
function randomOtherSlot(current: number): number {
  const next = Math.floor(Math.random() * (SLOTS_PERCENT.length - 1))
  return next >= current ? next + 1 : next
}
const SPARK_COLORS = ['bg-amber-400', 'bg-pink-500', 'bg-cyan-400', 'bg-violet-500']

interface Tier {
  gradient: string
  label: string
  shimmer: boolean
  /** Continuous motion on the corner number, livelier the longer the run. */
  idle: '' | 'combo-float' | 'combo-heartbeat'
}

// Hues climb with the run, so how long it has lasted reads from the corner of
// the eye without reading the number.
function tierFor(combo: number): Tier {
  if (combo >= 50) {
    return {
      gradient: 'from-fuchsia-600 via-rose-500 to-amber-500',
      label: 'text-fuchsia-600',
      shimmer: true,
      idle: 'combo-heartbeat',
    }
  }
  if (combo >= 25) {
    return {
      gradient: 'from-pink-500 via-rose-500 to-orange-400',
      label: 'text-rose-600',
      shimmer: false,
      idle: 'combo-float',
    }
  }
  if (combo >= 10) {
    return { gradient: 'from-amber-400 via-orange-500 to-red-500', label: 'text-orange-600', shimmer: false, idle: '' }
  }
  return { gradient: 'from-indigo-400 via-violet-500 to-purple-600', label: 'text-violet-600', shimmer: false, idle: '' }
}

/**
 * The live combo, drawn big over the corner of the score rather than in the
 * stat strip, so it can be followed while reading. At every milestone the
 * counter hops to another of five slots along its row, picked at random, and
 * bursts where it lands. Purely decorative: nothing in
 * it takes a pointer event, so it can sit on top of the staff without ever
 * stealing a long press or a scroll. Every animation is CSS (index.css,
 * `.combo-*`), restarted by re-keying the element, so a keypress costs one
 * small re-render and no timers except the one that clears a break.
 */
export function ComboOverlay({ combo, best, comboBreak, compact = false }: ComboOverlayProps) {
  const [shownBreak, setShownBreak] = useState<ComboBreak | null>(null)
  // The best as it stood when the current run started, so "new best" means
  // beating an earlier run, not merely being the first run of the session.
  const bestBeforeRunRef = useRef(0)
  if (combo === 0) {
    bestBeforeRunRef.current = best
  }

  // Where the counter rests. Kept across a broken run: it simply restarts
  // counting wherever it was.
  const [slot, setSlot] = useState(START_SLOT)
  // A milestone's hop and burst. Held in state with its own timer rather than
  // derived from `combo % 10`, so the next correct note (often well within the
  // hop) does not cut it short. A broken run cancels it.
  const [travelId, setTravelId] = useState<number | null>(null)
  const travelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (combo === 0) {
      setTravelId(null)
      return
    }
    if (combo % MILESTONE_EVERY !== 0) {
      return
    }
    if (travelTimeoutRef.current !== null) {
      clearTimeout(travelTimeoutRef.current)
    }
    setSlot((current) => randomOtherSlot(current))
    setTravelId(combo)
    travelTimeoutRef.current = setTimeout(() => {
      travelTimeoutRef.current = null
      setTravelId(null)
    }, TRAVEL_MS)
  }, [combo])
  useEffect(
    () => () => {
      if (travelTimeoutRef.current !== null) {
        clearTimeout(travelTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!comboBreak || comboBreak.value < MIN_BREAK_TO_SHOW) {
      return
    }
    setShownBreak(comboBreak)
    const timeout = setTimeout(() => setShownBreak(null), BREAK_ANIMATION_MS)
    return () => clearTimeout(timeout)
  }, [comboBreak])

  if (combo === 0 && !shownBreak) {
    return null
  }

  const tier = tierFor(combo)
  const isNewBest = combo > bestBeforeRunRef.current && bestBeforeRunRef.current >= MIN_BEST_TO_BEAT
  const numberSize = compact ? 'text-5xl' : 'text-8xl'
  const ringSize = compact ? 'h-16 w-16' : 'h-32 w-32'
  const slotLeft = `${SLOTS_PERCENT[slot]}%`
  // Each pop settles on the other side, so a run reads as the number dancing.
  const tiltStyle = { '--combo-tilt': combo % 2 === 0 ? '5deg' : '-5deg' } as CSSProperties

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 select-none">
      {travelId !== null && (
        // Clipped to the score, so sparks never fly over the controls above it.
        <div key={`burst-${travelId}`} className="absolute inset-0 overflow-hidden">
          <div
            className={`absolute flex -translate-x-1/2 items-center justify-center ${compact ? 'top-[28px]' : 'top-[60px]'}`}
            style={{ left: slotLeft }}
          >
            <span className={`combo-burst absolute rounded-full border-8 border-amber-400 ${ringSize}`} />
            {Array.from({ length: SPARK_COUNT }, (_, i) => (
              <span
                key={i}
                className={`combo-spark absolute rounded-sm ${SPARK_COLORS[i % SPARK_COLORS.length]} ${
                  compact ? 'h-2.5 w-2.5' : 'h-4 w-4'
                }`}
                style={
                  {
                    '--spark-angle': `${(360 / SPARK_COUNT) * i}deg`,
                    '--spark-distance': compact ? '90px' : '190px',
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* The slide itself is a CSS transition on `left`; the hop (a bounce in
          scale while it slides) is a keyed animation on the element inside. */}
      <div
        style={{ left: slotLeft }}
        className={`combo-slot absolute flex -translate-x-1/2 flex-col items-center ${compact ? 'top-1' : 'top-3'}`}
      >
        <div
          key={travelId === null ? 'still' : `hop-${travelId}`}
          className={`relative flex items-center justify-center ${travelId === null ? '' : 'combo-hop'}`}
        >
          <div className={`relative flex items-center justify-center ${tier.idle}`}>
            {combo > 0 && (
              <span
                key={combo}
                style={tiltStyle}
                className={`combo-pop combo-number font-combo bg-gradient-to-br bg-clip-text leading-none tabular-nums text-transparent ${
                  tier.gradient
                } ${numberSize} ${tier.shimmer ? 'combo-shimmer' : ''}`}
              >
                {combo}
              </span>
            )}
            {shownBreak && (
              <span
                key={`break-${shownBreak.id}`}
                className={`combo-break combo-number font-combo absolute right-0 top-0 leading-none tabular-nums text-red-500 line-through decoration-4 ${numberSize}`}
              >
                {shownBreak.value}
              </span>
            )}
          </div>
        </div>
        {combo > 0 && (
          <div className="combo-label mt-1 flex items-baseline gap-2">
            {isNewBest && (
              <span className="combo-new-best font-combo rounded-full bg-amber-400 px-2 pb-0.5 pt-1 text-[11px] uppercase tracking-wider text-white">
                New best
              </span>
            )}
            <span className={`font-combo uppercase tracking-[0.25em] ${tier.label} ${compact ? 'text-xs' : 'text-base'}`}>
              Combo
            </span>
          </div>
        )}
        {combo > 0 && !compact && best > combo && (
          <span className="combo-label mt-0.5 text-xs font-semibold text-gray-500">best {best}</span>
        )}
      </div>
    </div>
  )
}
