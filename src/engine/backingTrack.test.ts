import { describe, expect, it } from 'vitest'
import { bassMidiForDegree, buildBassProgression, midiToFrequency } from './backingTrack'

describe('backingTrack', () => {
  it('converts A4 midi pitch to 440 Hz', () => {
    expect(midiToFrequency(69)).toBe(440)
  })

  it('builds a I-V-vi-IV bass progression from the tonic pitch class', () => {
    // C major: I=C2(36), V=G2(43), vi=A2(45), IV=F2(41)
    expect(buildBassProgression(0)).toEqual([36, 43, 45, 41])
  })

  it('normalizes pitch classes into the low bass octave', () => {
    expect(bassMidiForDegree(14, 0)).toBe(38)
    expect(bassMidiForDegree(-1, 0)).toBe(47)
  })
})
