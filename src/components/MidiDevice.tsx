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
    return <p>Web MIDI API is not supported in this browser. Use Chrome or Edge.</p>
  }

  if (error) {
    return <p>MIDI error: {error}</p>
  }

  if (devices.length === 0) {
    return <p>No MIDI device detected. Connect a keyboard and reload.</p>
  }

  return (
    <select value={selectedDeviceId ?? ''} onChange={(e) => onSelect(e.target.value)}>
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}
        </option>
      ))}
    </select>
  )
}
