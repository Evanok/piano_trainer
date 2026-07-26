import { useRef, useState } from 'react'
import { MidiDevice } from '../components/MidiDevice'
import { getStreakStats } from '../engine/streakStore'
import type { MidiDeviceInfo } from '../types/midi'

const ALLOWED_EXTENSIONS = ['.musicxml', '.xml', '.mxl']

interface HomeProps {
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | null
  onSelectDevice: (id: string) => void
  isSupported: boolean
  midiError: string | null
  onFileLoaded: (scoreFile: File) => void
}

export function Home({ devices, selectedDeviceId, onSelectDevice, isSupported, midiError, onFileLoaded }: HomeProps) {
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Recomputed fresh every time Home mounts (App fully unmounts/remounts it
  // on screen switches), so it always reflects the latest practice day.
  const [streak] = useState(() => getStreakStats())

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
    if (!hasAllowedExtension) {
      setFileError('Please choose a .musicxml, .xml or .mxl file.')
      if (inputRef.current) {
        inputRef.current.value = ''
      }
      return
    }
    setFileError(null)
    onFileLoaded(file)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="text-3xl font-semibold text-gray-900">Piano Trainer</h1>

      {streak.totalDaysPracticed > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-gray-600">
          <span>
            {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'} streak
          </span>
          <span>
            Longest: {streak.longestStreak} day{streak.longestStreak === 1 ? '' : 's'}
          </span>
          <span>
            {streak.totalDaysPracticed} day{streak.totalDaysPracticed === 1 ? '' : 's'} practiced total
          </span>
        </div>
      )}

      <div className="flex w-full flex-col items-center gap-3">
        <label className="w-full cursor-pointer rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 py-8 text-sm text-gray-600 hover:border-gray-400">
          Choose a MusicXML score (.musicxml, .xml, .mxl)
          <input
            ref={inputRef}
            type="file"
            accept=".musicxml,.xml,.mxl"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
        {fileError && <p className="text-sm text-red-600">{fileError}</p>}
      </div>

      <div className="flex w-full flex-col items-center gap-2">
        <p className="text-sm font-medium text-gray-700">MIDI keyboard</p>
        <MidiDevice
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelect={onSelectDevice}
          isSupported={isSupported}
          error={midiError}
        />
      </div>
    </div>
  )
}
