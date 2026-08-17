import { describe, expect, it } from 'vitest'
import { selectHandStaff } from './ScoreParser'

// The staff objects only ever get compared by identity (a note's ParentStaff is
// matched against the selected one), so plain strings stand in for them here --
// which is the whole reason selectHandStaff is generic and separate from OSMD.
describe('selectHandStaff', () => {
  const grandStaff = [{ name: 'Piano', staves: ['treble', 'bass'] }]
  // Real layout of a downloaded score: the hands are two separate one-staff
  // parts, so there is no instrument with two staves to look inside.
  const splitParts = [
    { name: 'Piano, Right Hand', staves: ['upper'] },
    { name: 'Piano, Left Hand', staves: ['lower'] },
  ]

  it('picks the top staff for the right hand and the bottom one for the left', () => {
    expect(selectHandStaff(grandStaff, 'right')).toBe('treble')
    expect(selectHandStaff(grandStaff, 'left')).toBe('bass')
  })

  it('handles hands split across two single-staff parts', () => {
    expect(selectHandStaff(splitParts, 'right')).toBe('upper')
    expect(selectHandStaff(splitParts, 'left')).toBe('lower')
  })

  it('trusts an explicit "left hand" part name over score order', () => {
    const bottomFirst = [
      { name: 'Piano, Left Hand', staves: ['lower'] },
      { name: 'Piano, Right Hand', staves: ['upper'] },
    ]

    expect(selectHandStaff(bottomFirst, 'right')).toBe('upper')
    expect(selectHandStaff(bottomFirst, 'left')).toBe('lower')
  })

  it('requires nothing in particular for both hands', () => {
    expect(selectHandStaff(grandStaff, 'both')).toBeUndefined()
    expect(selectHandStaff(splitParts, 'both')).toBeUndefined()
  })

  it('filters nothing when there is no unambiguous pair of hand staves', () => {
    // One staff: an unsplit-hands score, or an already hand-scoped exercise.
    expect(selectHandStaff([{ name: 'Piano', staves: ['only'] }], 'right')).toBeUndefined()
    // Three staves (organ, or a four-hands arrangement): which two are "the
    // hands" is a guess, and requiring the wrong staff is worse than requiring
    // both -- it would silently zero out events.
    expect(selectHandStaff([{ name: 'Organ', staves: ['a', 'b', 'c'] }], 'left')).toBeUndefined()
    expect(selectHandStaff([], 'left')).toBeUndefined()
  })

  it('pairs staves across parts in score order, top part first', () => {
    const unnamed = [
      { name: null, staves: ['first'] },
      { name: null, staves: ['second'] },
    ]

    expect(selectHandStaff(unnamed, 'right')).toBe('first')
    expect(selectHandStaff(unnamed, 'left')).toBe('second')
  })
})
