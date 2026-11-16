import { useEffect, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { MetronomeIcon } from './icons'
import {
  BEATS_PER_BAR_CHOICES,
  DEFAULT_METRONOME_SETTINGS,
  MAX_BPM,
  MIN_BPM,
  Metronome,
  clampBpm,
  recentTaps,
  tapTempoBpm,
  type MetronomeSettings,
} from '../engine/metronome'
import { loadPreference, savePreference } from '../engine/preferencesStore'

interface MetronomeControlProps {
  /** Icon-only button for the one-row mobile header. */
  compact?: boolean
}

const BEAT_FLASH_MS = 110

// The score wrapper turns a held press into a cursor jump on mobile; a press
// inside the panel must not reach it.
const stopTouch = (event: ReactTouchEvent) => event.stopPropagation()

function beatsPerBarLabel(beats: number): string {
  return beats === 0 ? 'No accent' : `${beats} beats`
}

/**
 * The practice screen's metronome: one icon that opens a small panel (on/off,
 * tempo, accent, volume, tap tempo). It owns its `Metronome` and its beat
 * flash, so a tick re-renders this button and nothing else -- the practice
 * screen around it is far too heavy to re-render on every beat.
 *
 * Settings persist per device (`metronome` preference); whether it is ticking
 * does not, since a click starting by itself on opening a score would be a
 * surprise, and browsers would refuse it without a gesture anyway.
 */
export function MetronomeControl({ compact = false }: MetronomeControlProps) {
  const [settings, setSettings] = useState<MetronomeSettings>(() =>
    loadPreference('metronome', DEFAULT_METRONOME_SETTINGS),
  )
  const [isRunning, setIsRunning] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [flash, setFlash] = useState<'accent' | 'beat' | null>(null)
  const [bpmDraft, setBpmDraft] = useState(String(settings.bpm))
  const metronomeRef = useRef<Metronome | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tapsRef = useRef<number[]>([])
  const rootRef = useRef<HTMLDivElement | null>(null)

  const getMetronome = () => {
    if (!metronomeRef.current) {
      const metronome = new Metronome(settings)
      metronome.onBeat = (_beatInBar, accent) => {
        setFlash(accent ? 'accent' : 'beat')
        if (flashTimeoutRef.current !== null) {
          clearTimeout(flashTimeoutRef.current)
        }
        flashTimeoutRef.current = setTimeout(() => setFlash(null), BEAT_FLASH_MS)
      }
      metronomeRef.current = metronome
    }
    return metronomeRef.current
  }

  useEffect(() => {
    metronomeRef.current?.update(settings)
    savePreference('metronome', settings)
  }, [settings])

  useEffect(() => {
    return () => {
      metronomeRef.current?.dispose()
      metronomeRef.current = null
      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current)
      }
    }
  }, [])

  // Click or tap outside closes the panel.
  useEffect(() => {
    if (!isOpen) {
      return undefined
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const updateSettings = (patch: Partial<MetronomeSettings>) => {
    const next = { ...settings, ...patch }
    if (patch.bpm !== undefined) {
      next.bpm = clampBpm(patch.bpm)
      setBpmDraft(String(next.bpm))
    }
    setSettings(next)
  }

  const handleToggleRunning = async () => {
    const metronome = getMetronome()
    if (metronome.isRunning) {
      metronome.stop()
      setIsRunning(false)
      setFlash(null)
      return
    }
    const started = await metronome.start()
    setIsRunning(started)
  }

  const commitBpmDraft = () => {
    const parsed = Number(bpmDraft)
    updateSettings({ bpm: bpmDraft.trim() === '' ? settings.bpm : parsed })
  }

  const handleTap = () => {
    const now = performance.now()
    tapsRef.current = recentTaps([...tapsRef.current, now])
    const bpm = tapTempoBpm(tapsRef.current)
    if (bpm !== null) {
      updateSettings({ bpm })
    }
  }

  const iconTone = flash === 'accent'
    ? 'bg-indigo-600 text-white'
    : flash === 'beat'
      ? 'bg-indigo-200 text-indigo-800'
      : isRunning
        ? 'bg-indigo-50 text-indigo-700'
        : 'text-gray-600 hover:bg-gray-100'

  const stepButton =
    'h-8 w-8 shrink-0 rounded-md border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50'

  return (
    <div ref={rootRef} className="relative shrink-0" onTouchStart={stopTouch}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Metronome"
        aria-expanded={isOpen}
        title={isRunning ? `Metronome: ${settings.bpm} bpm` : 'Metronome'}
        className={
          compact
            ? `flex items-center gap-1 rounded-md p-2 transition-colors duration-75 ${iconTone}`
            : `flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-sm transition-colors duration-75 ${
                flash || isRunning ? iconTone : 'bg-white text-gray-600 hover:bg-gray-50'
              }`
        }
      >
        <MetronomeIcon className={compact ? 'h-5 w-5' : 'h-4 w-4'} />
        {compact ? (
          isRunning && <span className="text-xs font-semibold tabular-nums">{settings.bpm}</span>
        ) : (
          <span className="tabular-nums">{isRunning ? `${settings.bpm} bpm` : 'Metronome'}</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 shadow-xl">
          <button
            type="button"
            onClick={() => void handleToggleRunning()}
            className={
              isRunning
                ? 'w-full rounded-md bg-red-50 px-3 py-2 font-semibold text-red-700 hover:bg-red-100'
                : 'w-full rounded-md bg-indigo-600 px-3 py-2 font-semibold text-white hover:bg-indigo-700'
            }
          >
            {isRunning ? 'Stop' : 'Start'}
          </button>

          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => updateSettings({ bpm: settings.bpm - 1 })}
              aria-label="Slower"
              className={stepButton}
            >
              -
            </button>
            <input
              type="number"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpmDraft}
              onChange={(e) => setBpmDraft(e.target.value)}
              onBlur={commitBpmDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitBpmDraft()
                }
              }}
              aria-label="Tempo in beats per minute"
              className="h-8 w-16 min-w-0 rounded-md border border-gray-300 px-2 text-center tabular-nums"
            />
            <button
              type="button"
              onClick={() => updateSettings({ bpm: settings.bpm + 1 })}
              aria-label="Faster"
              className={stepButton}
            >
              +
            </button>
            <span className="text-xs text-gray-500">bpm</span>
            <button
              type="button"
              onClick={handleTap}
              className="ml-auto h-8 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Tap
            </button>
          </div>
          <input
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={settings.bpm}
            onChange={(e) => updateSettings({ bpm: Number(e.target.value) })}
            aria-label="Tempo"
            className="mt-2 w-full"
          />

          <label className="mt-3 flex items-center justify-between gap-2">
            Accent
            <select
              value={settings.beatsPerBar}
              onChange={(e) => updateSettings({ beatsPerBar: Number(e.target.value) })}
              className="rounded-md border border-gray-300 bg-white px-2 py-1"
            >
              {BEATS_PER_BAR_CHOICES.map((beats) => (
                <option key={beats} value={beats}>
                  {beatsPerBarLabel(beats)}
                </option>
              ))}
            </select>
          </label>

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
