import { describe, expect, it } from 'vitest'
import { measureIndexAt, playheadX } from './playhead'

const measures = [
  { start: 0, end: 0.5 },
  { start: 0.5, end: 1 },
  { start: 1, end: 1.5 },
]
// A wide first measure (clef, time signature), then two narrower ones.
const starts = [100, 400, 600, 800]
const xAt = (index: number) => starts[index] ?? null

describe('measureIndexAt', () => {
  it('finds the measure holding a position', () => {
    expect(measureIndexAt(measures, 0)).toBe(0)
    expect(measureIndexAt(measures, 0.49)).toBe(0)
    expect(measureIndexAt(measures, 0.5)).toBe(1)
    expect(measureIndexAt(measures, 9)).toBe(2)
    expect(measureIndexAt(measures, -0.1)).toBe(-1)
  })
})

describe('playheadX', () => {
  it('lands exactly on every downbeat', () => {
    expect(playheadX(measures, 0, xAt)).toBe(100)
    expect(playheadX(measures, 0.5, xAt)).toBe(400)
    expect(playheadX(measures, 1, xAt)).toBe(600)
  })

  it('moves at a constant speed inside a measure', () => {
    expect(playheadX(measures, 0.125, xAt)).toBe(175)
    expect(playheadX(measures, 0.25, xAt)).toBe(250)
    expect(playheadX(measures, 0.75, xAt)).toBe(500)
  })

  it('reaches the end of the last measure and stops there', () => {
    expect(playheadX(measures, 1.5, xAt)).toBe(800)
    expect(playheadX(measures, 4, xAt)).toBe(800)
  })

  it('holds still where the next measure is not drawn', () => {
    expect(playheadX(measures, 1.25, (index) => (index === 3 ? null : starts[index]))).toBe(600)
  })
})
