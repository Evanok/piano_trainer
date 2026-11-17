import { useEffect, useRef, useState } from 'react'
import { MAX_BPM, MIN_BPM, SCORE_TEMPO_PERCENTS, bpmAtPercent, recentTaps, tapTempoBpm } from '../engine/metronome'

/** The score's own tempo, when it states one, and the share of it to start from. */
export interface ScoreTempo {
  /** In the unit the bpm counts. */
  bpm: number
  onPercent: (percent: number) => void
}

interface TempoFieldProps {
  bpm: number
  onChange: (bpm: number) => void
  disabled?: boolean
  scoreTempo?: ScoreTempo | null
}

const STEP_BUTTON =
  'h-8 w-8 shrink-0 rounded-md border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40'

/**
 * The tempo, as a field with -/+ steppers, a tap button and a slider. Used by
 * both the metronome and the auto-scroll panels, which share one tempo.
 */
export function TempoField({ bpm, onChange, disabled = false, scoreTempo = null }: TempoFieldProps) {
  const [draft, setDraft] = useState(String(bpm))
  const tapsRef = useRef<number[]>([])

  // The field follows every change made elsewhere (slider, steppers, tap, the other panel).
  useEffect(() => {
    setDraft(String(bpm))
  }, [bpm])

  const commitDraft = () => {
    const parsed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(bpm))
      return
    }
    onChange(parsed)
  }

  const handleTap = () => {
    tapsRef.current = recentTaps([...tapsRef.current, performance.now()])
    const tapped = tapTempoBpm(tapsRef.current)
    if (tapped !== null) {
      onChange(tapped)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(bpm - 1)}
          disabled={disabled}
          aria-label="Slower"
          className={STEP_BUTTON}
        >
          -
        </button>
        <input
          type="number"
          min={MIN_BPM}
          max={MAX_BPM}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitDraft()
            }
          }}
          aria-label="Tempo in beats per minute"
          className="h-8 w-16 min-w-0 rounded-md border border-gray-300 px-2 text-center tabular-nums"
        />
        <button
          type="button"
          onClick={() => onChange(bpm + 1)}
          disabled={disabled}
          aria-label="Faster"
          className={STEP_BUTTON}
        >
          +
        </button>
        <span className="text-xs text-gray-500">bpm</span>
        <button
          type="button"
          onClick={handleTap}
          disabled={disabled}
          className="ml-auto h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          Tap
        </button>
      </div>
      <input
        type="range"
        min={MIN_BPM}
        max={MAX_BPM}
        step={1}
        value={bpm}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Tempo"
        className="mt-2 w-full"
      />
      {scoreTempo && (
        <div className="mt-2">
          <p className="text-xs text-gray-500">
            Score tempo {Math.round(scoreTempo.bpm)} bpm, now at {Math.round((bpm / scoreTempo.bpm) * 100)}%
          </p>
          <div className="mt-1 flex gap-1">
            {SCORE_TEMPO_PERCENTS.map((percent) => {
              // Lit when the tempo is exactly that share, whichever way it got there.
              const active = bpmAtPercent(scoreTempo.bpm, percent) === bpm
              return (
                <button
                  key={percent}
                  type="button"
                  onClick={() => scoreTempo.onPercent(percent)}
                  disabled={disabled}
                  className={`h-7 min-w-0 flex-1 rounded-md border text-xs font-semibold tabular-nums disabled:opacity-40 ${
                    active
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {percent}%
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
