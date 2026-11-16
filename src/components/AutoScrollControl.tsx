import { AutoScrollIcon } from './icons'
import { TempoField } from './TempoField'
import { formatMeter, isCompoundMeter, type Meter } from '../engine/metronome'
import { stopTouch, usePopover } from '../hooks/usePopover'

interface AutoScrollControlProps {
  /** Icon-only button for the one-row mobile header. */
  compact?: boolean
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  /** Why auto-scroll cannot be turned on right now, or null when it can. */
  unavailable: string | null
  bpm: number
  onBpmChange: (bpm: number) => void
  /** The meter the tempo counts in (the metronome's), null when there is none. */
  meter: Meter | null
  /** A run is under way: the tempo cannot change under it. */
  runActive: boolean
}

function beatUnitHint(meter: Meter | null): string {
  if (!meter) {
    return 'The bpm counts quarter notes.'
  }
  if (isCompoundMeter(meter) || meter.denominator === 8) {
    return `The bpm counts eighth notes (${formatMeter(meter)}).`
  }
  if (meter.denominator === 2) {
    return `The bpm counts half notes (${formatMeter(meter)}).`
  }
  return `The bpm counts quarter notes (${formatMeter(meter)}).`
}

/**
 * The tempo mode's own header control, apart from the metronome: auto-scroll
 * is used with or without the click, so it is not hidden behind it. The two
 * share one tempo (and the metronome's time signature, which sets the beat
 * unit), so turning the click on during a run is always in time with it.
 */
export function AutoScrollControl({
  compact = false,
  enabled,
  onEnabledChange,
  unavailable,
  bpm,
  onBpmChange,
  meter,
  runActive,
}: AutoScrollControlProps) {
  const { isOpen, setIsOpen, rootRef } = usePopover()
  const active = enabled && unavailable === null

  return (
    <div ref={rootRef} className="relative shrink-0" onTouchStart={stopTouch}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Auto-scroll"
        aria-expanded={isOpen}
        title={active ? `Auto-scroll: ${bpm} bpm` : 'Auto-scroll'}
        className={
          compact
            ? `flex items-center gap-1 rounded-md p-2 ${
                active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
              }`
            : `flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                active
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`
        }
      >
        <AutoScrollIcon className={compact ? 'h-5 w-5' : 'h-4 w-4'} />
        {compact ? (
          active && <span className="text-xs font-semibold tabular-nums">{bpm}</span>
        ) : (
          <span className="tabular-nums">{active ? `Auto-scroll ${bpm} bpm` : 'Auto-scroll'}</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 shadow-xl">
          <label className={`flex items-center justify-between gap-2 ${unavailable ? 'opacity-50' : ''}`}>
            <span>
              <span className="font-medium">Auto-scroll</span>
              <span className="block text-xs text-gray-500">
                {unavailable ?? 'The score moves by itself; play each note on its beat.'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={unavailable !== null}
              onChange={(e) => onEnabledChange(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-indigo-600"
            />
          </label>

          <hr className="my-3 border-gray-200" />
          {runActive && <p className="mb-2 text-xs text-amber-700">Stop the run to change the speed.</p>}
          <TempoField bpm={bpm} onChange={onBpmChange} disabled={runActive} />
          <p className="mt-2 text-xs text-gray-500">
            {beatUnitHint(meter)} Same tempo as the metronome, which can stay off.
          </p>
        </div>
      )}
    </div>
  )
}
