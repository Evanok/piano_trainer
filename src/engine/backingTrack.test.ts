import { describe, expect, it } from 'vitest'
import { buildSoftPadVoices, midiToFrequency, tonicPadMidi } from './backingTrack'

describe('backingTrack', () => {
  it('converts A4 midi pitch to 440 Hz', () => {
    expect(midiToFrequency(69)).toBe(440)
  })

  it('builds a neutral tonic-fifth-octave pad', () => {
    expect(buildSoftPadVoices(0).map((voice) => voice.midi)).toEqual([48, 55, 60])
  })

  it('normalizes pitch classes into the lower pad octave', () => {
    expect(tonicPadMidi(14)).toBe(50)
    expect(tonicPadMidi(-1)).toBe(59)
  })
})
