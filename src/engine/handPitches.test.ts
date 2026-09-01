import { describe, expect, it } from 'vitest'
import { handPitchesOf } from './handPitches'
import type { ExpectedEvent } from '../types/score'

const C4 = 60
const E4 = 64
const C3 = 48

describe('handPitchesOf', () => {
  it('splits an event onto the hand each note was written for', () => {
    const event: ExpectedEvent = {
      index: 0,
      pitches: [C4, E4, C3],
      measureNumber: 1,
      hands: ['right', 'right', 'left'],
    }

    expect(handPitchesOf(event)).toEqual({ right: [C4, E4], left: [C3], fingerByPitch: {} })
  })

  it('lists a pitch written on both staves under both hands', () => {
    const event: ExpectedEvent = {
      index: 0,
      pitches: [C4, C4],
      measureNumber: 1,
      hands: ['right', 'left'],
    }

    expect(handPitchesOf(event)).toEqual({ right: [C4], left: [C4], fingerByPitch: {} })
  })

  it('says nothing when the score has no unambiguous pair of hands', () => {
    const event: ExpectedEvent = { index: 0, pitches: [C4, E4], measureNumber: 1, hands: [null, null] }

    expect(handPitchesOf(event)).toEqual({ right: [], left: [], fingerByPitch: {} })
  })

  it('has no hands to report past the end of the piece', () => {
    expect(handPitchesOf(undefined)).toEqual({ right: [], left: [], fingerByPitch: {} })
  })

  it('treats an event carrying no hands at all the same as unknown hands', () => {
    expect(handPitchesOf({ index: 0, pitches: [C4], measureNumber: 1 })).toEqual({
      right: [],
      left: [],
      fingerByPitch: {},
    })
  })
  it('keys the fingers the score states onto the pitches they belong to', () => {
    const event: ExpectedEvent = {
      index: 0,
      pitches: [C4, E4, C3],
      measureNumber: 1,
      hands: ['right', 'right', 'left'],
      fingers: [1, 3, 5],
    }

    expect(handPitchesOf(event).fingerByPitch).toEqual({ [C4]: 1, [E4]: 3, [C3]: 5 })
  })

  it('reports only the notes that name a finger, not the rest of the chord', () => {
    const event: ExpectedEvent = {
      index: 0,
      pitches: [C4, E4],
      measureNumber: 1,
      hands: ['right', 'right'],
      fingers: [null, 3],
    }

    expect(handPitchesOf(event).fingerByPitch).toEqual({ [E4]: 3 })
  })

  // Only one number fits under a key, so picking one of two disagreeing
  // fingerings would be inventing an answer -- the key shows none instead.
  it('drops a finger contradicted by another note of the same pitch', () => {
    const event: ExpectedEvent = {
      index: 0,
      pitches: [C4, C4],
      measureNumber: 1,
      hands: ['right', 'left'],
      fingers: [1, 5],
    }

    expect(handPitchesOf(event).fingerByPitch).toEqual({})
  })

  it('keeps a stated finger when the other note of that pitch merely says nothing', () => {
    const event: ExpectedEvent = {
      index: 0,
      pitches: [C4, C4],
      measureNumber: 1,
      hands: ['right', 'left'],
      fingers: [2, null],
    }

    expect(handPitchesOf(event).fingerByPitch).toEqual({ [C4]: 2 })
  })

  it('reports fingers for a score whose hands are not knowable', () => {
    const event: ExpectedEvent = { index: 0, pitches: [C4], measureNumber: 1, hands: [null], fingers: [4] }

    expect(handPitchesOf(event)).toEqual({ right: [], left: [], fingerByPitch: { [C4]: 4 } })
  })
})
