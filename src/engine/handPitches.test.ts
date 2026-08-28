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

    expect(handPitchesOf(event)).toEqual({ right: [C4, E4], left: [C3] })
  })

  it('lists a pitch written on both staves under both hands', () => {
    const event: ExpectedEvent = {
      index: 0,
      pitches: [C4, C4],
      measureNumber: 1,
      hands: ['right', 'left'],
    }

    expect(handPitchesOf(event)).toEqual({ right: [C4], left: [C4] })
  })

  it('says nothing when the score has no unambiguous pair of hands', () => {
    const event: ExpectedEvent = { index: 0, pitches: [C4, E4], measureNumber: 1, hands: [null, null] }

    expect(handPitchesOf(event)).toEqual({ right: [], left: [] })
  })

  it('has no hands to report past the end of the piece', () => {
    expect(handPitchesOf(undefined)).toEqual({ right: [], left: [] })
  })

  it('treats an event carrying no hands at all the same as unknown hands', () => {
    expect(handPitchesOf({ index: 0, pitches: [C4], measureNumber: 1 })).toEqual({ right: [], left: [] })
  })
})
