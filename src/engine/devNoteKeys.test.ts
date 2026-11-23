import { describe, expect, it } from 'vitest'
import { devNotePitches } from './devNoteKeys'

describe('devNotePitches', () => {
  it('plays every expected note not yet held on o', () => {
    expect(devNotePitches('o', { expected: [60, 64, 67], held: [64] })).toEqual([60, 67])
    expect(devNotePitches('O', { expected: [60], held: [] })).toEqual([60])
  })

  it('plays one unexpected note on k', () => {
    expect(devNotePitches('k', { expected: [60, 61, 62], held: [] })).toEqual([63])
    expect(devNotePitches('k', { expected: [], held: [] })).toEqual([61])
  })

  it('ignores every other key', () => {
    expect(devNotePitches('a', { expected: [60], held: [] })).toBeNull()
  })
})
