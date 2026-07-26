import { describe, expect, it } from 'vitest'
import { computeGrade } from './grade'

describe('computeGrade', () => {
  it('grades a flawless run as S', () => {
    expect(computeGrade(100)).toBe('S')
  })

  it('grades boundary values at the lower edge of each band', () => {
    expect(computeGrade(90)).toBe('A')
    expect(computeGrade(75)).toBe('B')
    expect(computeGrade(60)).toBe('C')
    expect(computeGrade(40)).toBe('D')
  })

  it('grades just below a boundary into the band below', () => {
    expect(computeGrade(99)).toBe('A')
    expect(computeGrade(89)).toBe('B')
    expect(computeGrade(74)).toBe('C')
    expect(computeGrade(59)).toBe('D')
    expect(computeGrade(39)).toBe('F')
  })

  it('grades zero accuracy as F', () => {
    expect(computeGrade(0)).toBe('F')
  })
})
