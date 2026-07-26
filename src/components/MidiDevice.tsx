import type { MidiDeviceInfo } from '../types/midi'

interface MidiDeviceProps {
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | null
  onSelect: (id: string) => void
  isSupported: boolean
  error: string | null
}

export function MidiDevice({ devices, selectedDeviceId, onSelect, isSupported, error }: MidiDeviceProps) {
  if (!isSupported) {
    return <p className="text-sm text-amber-600">Web MIDI API is not supported in this browser. Use Chrome or Edge.</p>
  }

  if (error) {
    return <p className="text-sm text-red-600">MIDI error: {error}</p>
  }

  if (devices.length === 0) {
    return <p className="text-sm text-gray-500">No MIDI device detected. Connect a keyboard and reload.</p>
  }

  return (
    <select
      value={selectedDeviceId ?? ''}
      onChange={(e) => onSelect(e.target.value)}
      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
    >
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}
        </option>
      ))}
    </select>
  )
}
