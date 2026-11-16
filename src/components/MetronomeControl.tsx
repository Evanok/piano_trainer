import { useEffect, useRef, useState } from 'react'
import { MetronomeIcon } from './icons'
import { TempoField } from './TempoField'
import { METER_CHOICES, formatMeter, isCompoundMeter, type Meter, type MeterChoice } from '../engine/metronome'
import type { MetronomeState } from '../hooks/useMetronome'
import { stopTouch, usePopover } from '../hooks/usePopover'

interface MetronomeControlProps {
  /** Icon-only button for the one-row mobile header. */
  compact?: boolean
  metronome: MetronomeState
  /** The piece's opening time signature, null until loaded or when it states none. */
  scoreMeter: Meter | null
  /** An auto-scroll run is under way: tempo and meter cannot change under it. */
  runActive: boolean
}

const BEAT_FLASH_MS = 110

function meterHint(meter: Meter | null, bpm: number): string {
  if (!meter) {
    return 'Every click the same.'
  }
  if (isCompoundMeter(meter)) {
    return `${meter.numerator} eighths per bar, accents on 1 and every 3. ${bpm} bpm counts eighths.`
  }
  return `${meter.numerator} clicks per bar, accent on 1.`
}

/**
 * The practice screen's metronome: one icon that opens a small panel (on/off,
 * tempo, time signature, volume, tap tempo). The state lives in
 * `useMetronome` (Practice), since auto-scroll shares the tempo; only the
 * beat flash lives here, so a tick re-renders this button and nothing else --
 * the practice screen around it is far too heavy for that.
 *
 * The time signature follows the score by default ('score'), so the accent
 * lands where the piece's bar starts without touching anything; a fixed one
 * can still be forced. Only the opening signature is read: a piece that
 * changes meter midway keeps counting the first one.
 */
export function MetronomeControl({ compact = false, metronome, scoreMeter, runActive }: MetronomeControlProps) {
  const { settings, updateSettings, meter, soundOn, toggleSound, subscribeBeat } = metronome
  const { isOpen, setIsOpen, rootRef } = usePopover()
  const [flash, setFlash] = useState<'accent' | 'beat' | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeBeat((accent) => {
      setFlash(accent === 'strong' ? 'accent' : 'beat')
      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current)
      }
      flashTimeoutRef.current = setTimeout(() => setFlash(null), BEAT_FLASH_MS)
    })
    return () => {
      unsubscribe()
      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current)
      }
    }
  }, [subscribeBeat])

  const iconTone =
    flash === 'accent'
      ? 'bg-indigo-600 text-white'
      : flash === 'beat'
        ? 'bg-indigo-200 text-indigo-800'
        : soundOn
          ? 'bg-indigo-50 text-indigo-700'
          : 'text-gray-600 hover:bg-gray-100'

  return (
    <div ref={rootRef} className="relative shrink-0" onTouchStart={stopTouch}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Metronome"
        aria-expanded={isOpen}
        title={soundOn ? `Metronome: ${settings.bpm} bpm` : 'Metronome'}
        className={
          compact
            ? `flex items-center gap-1 rounded-md p-2 transition-colors duration-75 ${iconTone}`
            : `flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-sm transition-colors duration-75 ${
                flash || soundOn ? iconTone : 'bg-white text-gray-600 hover:bg-gray-50'
              }`
        }
      >
        <MetronomeIcon className={compact ? 'h-5 w-5' : 'h-4 w-4'} />
        {compact ? (
          soundOn && <span className="text-xs font-semibold tabular-nums">{settings.bpm}</span>
        ) : (
          <span className="tabular-nums">{soundOn ? `${settings.bpm} bpm` : 'Metronome'}</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 shadow-xl">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Metronome</span>
            <button
              type="button"
              onClick={() => void toggleSound()}
              className={
                soundOn
                  ? 'rounded-md bg-red-50 px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100'
                  : 'rounded-md bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700'
              }
            >
              {soundOn ? 'Stop' : 'Start'}
            </button>
          </div>

          {runActive && (
            <p className="mt-3 text-xs text-amber-700">Stop the auto-scroll run to change the tempo or time signature.</p>
          )}
          <div className="mt-3">
            <TempoField bpm={settings.bpm} onChange={(bpm) => updateSettings({ bpm })} disabled={runActive} />
          </div>

          <label className="mt-3 flex items-center justify-between gap-2">
            Time signature
            <select
              value={settings.meter}
              disabled={runActive}
              onChange={(e) => updateSettings({ meter: e.target.value as MeterChoice })}
              className="rounded-md border border-gray-300 bg-white px-2 py-1"
            >
              <option value="score">{scoreMeter ? `Auto (${formatMeter(scoreMeter)})` : 'Auto'}</option>
              {/* The score's own signature is already the Auto entry; listing
                  it again would offer two options that sound the same. */}
              {METER_CHOICES.filter((choice) => !scoreMeter || choice !== formatMeter(scoreMeter)).map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
              <option value="none">No accent</option>
            </select>
          </label>
          <p className="mt-1 text-xs text-gray-500">{meterHint(meter, settings.bpm)}</p>

          <label className="mt-3 flex items-center gap-2">
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
              className="min-w-0 flex-1"
            />
          </label>
        </div>
      )}
    </div>
  )
}
