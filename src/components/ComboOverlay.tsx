import { useEffect, useRef, useState } from 'react'

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

interface Tier {
  gradient: string
  label: string
  shimmer: boolean
}

// Hues climb with the run, so how long it has lasted reads from the corner of
// the eye without reading the number.
function tierFor(combo: number): Tier {
  if (combo >= 50) {
    return {
      gradient: 'from-fuchsia-600 via-rose-500 to-amber-500',
      label: 'text-fuchsia-600',
      shimmer: true,
    }
  }
  if (combo >= 25) {
    return { gradient: 'from-pink-500 via-rose-500 to-orange-400', label: 'text-rose-600', shimmer: false }
  }
  if (combo >= 10) {
    return { gradient: 'from-amber-400 via-orange-500 to-red-500', label: 'text-orange-600', shimmer: false }
  }
  return { gradient: 'from-indigo-400 via-violet-500 to-purple-600', label: 'text-violet-600', shimmer: false }
}

/**
 * The live combo, drawn big over the corner of the score rather than in the
 * stat strip, so it can be followed while reading. Purely decorative: it never
 * takes a pointer event, so it can sit on top of the staff without ever
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
  const isMilestone = combo > 0 && combo % MILESTONE_EVERY === 0
  const isNewBest = combo > bestBeforeRunRef.current && bestBeforeRunRef.current >= MIN_BEST_TO_BEAT
  const numberSize = compact ? 'text-5xl' : 'text-8xl'
  const ringSize = compact ? 'h-16 w-16' : 'h-32 w-32'

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 flex select-none flex-col items-end ${
        compact ? 'right-2 top-1' : 'right-5 top-3'
      }`}
    >
      <div className="relative flex items-center justify-center">
        {isMilestone && (
          <span
            key={`ring-${combo}`}
            className={`combo-burst absolute rounded-full border-4 border-amber-400 ${ringSize}`}
          />
        )}
        {combo > 0 && (
          <span
            key={combo}
            className={`combo-pop combo-number bg-gradient-to-br bg-clip-text font-black leading-none tabular-nums text-transparent ${
              tier.gradient
            } ${numberSize} ${tier.shimmer ? 'combo-shimmer' : ''}`}
          >
            {combo}
          </span>
        )}
        {shownBreak && (
          <span
            key={`break-${shownBreak.id}`}
            className={`combo-break combo-number absolute right-0 top-0 font-black leading-none tabular-nums text-red-500 line-through decoration-4 ${numberSize}`}
          >
            {shownBreak.value}
          </span>
        )}
      </div>
      {combo > 0 && (
        <div className="combo-label mt-1 flex items-baseline gap-2">
          {isNewBest && (
            <span className="combo-new-best rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
              New best
            </span>
          )}
          <span className={`font-black uppercase tracking-[0.3em] ${tier.label} ${compact ? 'text-[10px]' : 'text-sm'}`}>
            Combo
          </span>
        </div>
      )}
      {combo > 0 && !compact && best > combo && (
        <span className="combo-label mt-0.5 text-xs font-semibold text-gray-500">best {best}</span>
      )}
    </div>
  )
}
