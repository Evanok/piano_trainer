import { describe, expect, it } from 'vitest'
import { anchorsAround, measureIndexAt, playheadX } from './playhead'

// Two measures of 2/4: a half note, then quarter + quarter.
const measures = [
  { start: 0, end: 0.5, onsets: [0] },
  { start: 0.5, end: 1, onsets: [0.5, 0.75] },
]
// A wide first measure (clef), and a second quarter drawn closer than its
// time would put it: engraving is not proportional.
const positions = new Map([
  [0, 100],
  [0.5, 400],
  [0.75, 460],
  [1, 700],
])
const xAt = (t: number) => positions.get(t) ?? null

describe('measureIndexAt', () => {
  it('finds the measure holding a position', () => {
    expect(measureIndexAt(measures, 0)).toBe(0)
    expect(measureIndexAt(measures, 0.49)).toBe(0)
    expect(measureIndexAt(measures, 0.5)).toBe(1)
    expect(measureIndexAt(measures, 9)).toBe(1)
    expect(measureIndexAt(measures, -0.1)).toBe(-1)
  })
})

describe('anchorsAround', () => {
  it('picks the onsets on either side, crossing into the next measure', () => {
    expect(anchorsAround(measures, 0, 0.25)).toEqual({ from: 0, to: 0.5 })
    expect(anchorsAround(measures, 1, 0.6)).toEqual({ from: 0.5, to: 0.75 })
    expect(anchorsAround(measures, 1, 0.8)).toEqual({ from: 0.75, to: 1 })
  })
})

describe('playheadX', () => {
  it('is exactly on every onset at its time, mid-measure ones included', () => {
    expect(playheadX(measures, 0, xAt)).toBe(100)
    expect(playheadX(measures, 0.5, xAt)).toBe(400)
    // A constant speed through the measure would be at 550 here.
    expect(playheadX(measures, 0.75, xAt)).toBe(460)
  })

  it('moves at a constant speed between two onsets', () => {
    expect(playheadX(measures, 0.25, xAt)).toBe(250)
    expect(playheadX(measures, 0.625, xAt)).toBe(430)
    expect(playheadX(measures, 0.875, xAt)).toBe(580)
  })

  it('reaches the end of the last measure and stops there', () => {
    expect(playheadX(measures, 1, xAt)).toBe(700)
    expect(playheadX(measures, 4, xAt)).toBe(700)
  })

  it('holds still where the next anchor is not drawn', () => {
    expect(playheadX(measures, 0.9, (t) => (t === 1 ? null : xAt(t)))).toBe(460)
  })
})
