import { useCallback, useEffect, useRef, useState } from 'react'
import type { MidiDeviceInfo, MidiNoteEvent } from '../types/midi'

export interface UseMidiResult {
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | null
  selectDevice: (id: string) => void
  isSupported: boolean
  error: string | null
  onNoteEvent: (listener: (event: MidiNoteEvent) => void) => () => void
}

function decodeNoteEvent(data: Uint8Array, timestamp: number): MidiNoteEvent | null {
  if (data.length < 3) {
    return null
  }
  const [statusByte, pitch, velocity] = data
  const command = statusByte & 0xf0
  if (command === 0x90 && velocity > 0) {
    return { pitch, velocity, timestamp, type: 'noteon' }
  }
  if (command === 0x80 || (command === 0x90 && velocity === 0)) {
    return { pitch, velocity, timestamp, type: 'noteoff' }
  }
  return null
}

export function useMidi(): UseMidiResult {
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const midiAccessRef = useRef<MIDIAccess | null>(null)
  const listenersRef = useRef<Set<(event: MidiNoteEvent) => void>>(new Set())

  const isSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator

  useEffect(() => {
    if (!isSupported) {
      setError('Web MIDI API is not supported in this browser (e.g. Safari/iOS).')
      return
    }

    let cancelled = false

    navigator.requestMIDIAccess().then(
      (access) => {
        if (cancelled) {
          return
        }
        midiAccessRef.current = access
        const updateDevices = () => {
          const inputs = Array.from(access.inputs.values())
          setDevices(inputs.map((input) => ({ id: input.id, name: input.name ?? input.id })))
        }
        updateDevices()
        access.onstatechange = updateDevices
      },
      (err: unknown) => {
        if (cancelled) {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to access MIDI devices.')
      },
    )

    return () => {
      cancelled = true
    }
  }, [isSupported])

  useEffect(() => {
    if (devices.length > 0 && selectedDeviceId === null) {
      setSelectedDeviceId(devices[0].id)
    }
  }, [devices, selectedDeviceId])

  useEffect(() => {
    const access = midiAccessRef.current
    if (!access || selectedDeviceId === null) {
      return
    }
    const input = access.inputs.get(selectedDeviceId)
    if (!input) {
      return
    }

    const handleMessage = (message: MIDIMessageEvent) => {
      if (!message.data) {
        return
      }
      const event = decodeNoteEvent(message.data, message.timeStamp)
      if (event) {
        listenersRef.current.forEach((listener) => listener(event))
      }
    }

    input.onmidimessage = handleMessage
    return () => {
      input.onmidimessage = null
    }
  }, [selectedDeviceId, devices])

  const selectDevice = useCallback((id: string) => {
    setSelectedDeviceId(id)
  }, [])

  const onNoteEvent = useCallback((listener: (event: MidiNoteEvent) => void) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  return { devices, selectedDeviceId, selectDevice, isSupported, error, onNoteEvent }
}
