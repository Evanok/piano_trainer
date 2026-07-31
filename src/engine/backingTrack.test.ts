import { describe, expect, it } from 'vitest'
import { backingTrackAudioUrl, backingTrackTakesFor } from './backingTrack'

describe('backingTrack', () => {
  it('lists the recorded takes for a key that has audio', () => {
    expect(backingTrackTakesFor('C major')).toEqual(['c1', 'c2', 'c3'])
  })

  it('returns no takes for a key without recorded audio yet', () => {
    expect(backingTrackTakesFor('B-flat major')).toEqual([])
  })

  it('builds a url from a deterministically picked take', () => {
    expect(backingTrackAudioUrl('D major', () => 0)).toBe('/audio/backing-tracks/d1.wav')
    expect(backingTrackAudioUrl('D major', () => 0.99)).toBe('/audio/backing-tracks/d2.wav')
  })

  it('returns null when no audio is available for the key', () => {
    expect(backingTrackAudioUrl('E-flat major')).toBeNull()
  })
})
