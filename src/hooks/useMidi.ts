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
          // Chrome keeps an unplugged port in `inputs` with state 'disconnected', and a
          // replugged keyboard (USB-OTG on a tablet that slept) can come back as a new
          // port, so listing both would offer a dead one.
          const inputs = Array.from(access.inputs.values()).filter((input) => input.state === 'connected')
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

  // The selection must always name a port that exists. A reconnected keyboard can get
  // a new id, and a stale id here listened to nothing while the <select>, whose value
  // then matched no option, still displayed the first device as if it were selected.
  // Falls back to the same name first, so a reconnect keeps the player's choice.
  const selectedNameRef = useRef<string | null>(null)
  useEffect(() => {
    if (devices.length === 0) {
      return
    }
    const current = devices.find((device) => device.id === selectedDeviceId)
    if (current) {
      selectedNameRef.current = current.name
      return
    }
    const sameName = devices.find((device) => device.name === selectedNameRef.current)
    setSelectedDeviceId((sameName ?? devices[0]).id)
  }, [devices, selectedDeviceId])

  useEffect(() => {
    const access = midiAccessRef.current
    if (!access || selectedDeviceId === null) {
      return
    }
    const input = access.inputs.get(selectedDeviceId)
    if (!input || input.state !== 'connected') {
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
    // Setting the handler opens the port implicitly, but not reliably again on Android
    // after the device woke up, so ask for it explicitly. A failure leaves nothing worse.
    input.open().catch(() => {})
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
