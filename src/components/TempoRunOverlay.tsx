interface TempoRunOverlayProps {
  phase: 'idle' | 'countIn' | 'running'
  /** Beats left in the count-in, null outside it. */
  countInBeat: number | null
  bpm: number
  compact?: boolean
}

/**
 * Drawn over the score in the tempo mode: what to press before a run, and the
 * count-in beats once it starts. Nothing while the score is moving, which is
 * when the notes need the whole screen. Takes no pointer events, so the long
 * press on the staff still works under it.
 */
export function TempoRunOverlay({ phase, countInBeat, bpm, compact = false }: TempoRunOverlayProps) {
  if (phase === 'countIn' && countInBeat !== null) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span
          key={countInBeat}
          className={`font-combo text-indigo-600/80 drop-shadow ${compact ? 'text-6xl' : 'text-8xl'}`}
        >
          {countInBeat}
        </span>
      </div>
    )
  }
  if (phase === 'idle') {
    return (
      <p
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-md bg-indigo-600/90 px-3 py-1.5 font-medium text-white shadow-lg ${
          compact ? 'bottom-2 text-xs' : 'bottom-3 text-sm'
        }`}
      >
        Auto-scroll at {bpm} bpm -- press Start, one bar of count-in, then play on the beat
      </p>
    )
  }
  return null
}
