import { describe, expect, it } from 'vitest'
import { backingTrackAudioUrl, backingTrackTakesFor } from './backingTrack'

describe('backingTrack', () => {
  it('lists both recorded sources for every major key', () => {
    expect(backingTrackTakesFor('B-flat major')).toEqual([
      { source: 'adg-blues', fileName: 'Bb-major.m4a' },
      { source: 'paul-maine-jazz', fileName: 'Bb-major.mp3' },
    ])
  })

  it('builds a URL from a deterministically picked source', () => {
    expect(backingTrackAudioUrl('D major', () => 0)).toBe(
      '/audio/backing-tracks/adg-blues/D-major.m4a',
    )
    expect(backingTrackAudioUrl('D major', () => 0.99)).toBe(
      '/audio/backing-tracks/paul-maine-jazz/D-major.mp3',
    )
  })

  it('does not use major backing tracks for minor exercises', () => {
    expect(backingTrackTakesFor('E-flat minor')).toEqual([])
    expect(backingTrackAudioUrl('E-flat minor')).toBeNull()
  })
})
