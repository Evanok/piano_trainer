import { describe, expect, it } from 'vitest'
import { noteFinger, selectHandStaff, selectHandStaves } from './ScoreParser'

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

// The pair behind selectHandStaff, used to label each required note with the
// hand it belongs to (the virtual keyboard's hand channel).
describe('selectHandStaves', () => {
  it('pairs the staves top-first, whichever layout the file uses', () => {
    expect(selectHandStaves([{ name: 'Piano', staves: ['treble', 'bass'] }])).toEqual({
      right: 'treble',
      left: 'bass',
    })
    expect(
      selectHandStaves([
        { name: 'Piano, Left Hand', staves: ['lower'] },
        { name: 'Piano, Right Hand', staves: ['upper'] },
      ]),
    ).toEqual({ right: 'upper', left: 'lower' })
  })

  it('answers nothing when there is no unambiguous pair of hands', () => {
    expect(selectHandStaves([{ name: 'Piano', staves: ['only'] }])).toBeUndefined()
    expect(selectHandStaves([{ name: 'Organ', staves: ['a', 'b', 'c'] }])).toBeUndefined()
  })
})

// OSMD fills Note.Fingering from the file at parse time, so this only ever has
// to read it -- and to refuse the values it cannot read as a plain finger.
describe('noteFinger', () => {
  it('reads a plain finger number', () => {
    expect(noteFinger({ Fingering: { value: '1' } })).toBe(1)
    expect(noteFinger({ Fingering: { value: '5' } })).toBe(5)
    expect(noteFinger({ Fingering: { value: ' 3 ' } })).toBe(3)
  })

  it('says nothing for a note the score leaves unfingered', () => {
    expect(noteFinger({})).toBeNull()
    expect(noteFinger({ Fingering: undefined })).toBeNull()
    expect(noteFinger({ Fingering: { value: '' } })).toBeNull()
  })

  // Real case, twice, in a downloaded Tchaikovsky: one element whose text is
  // "43", meaning strike with 4 and substitute 3 while holding. Whichever
  // convention the edition follows, the first digit is the finger that presses.
  it('takes the striking finger out of a label naming several', () => {
    expect(noteFinger({ Fingering: { value: '43' } })).toBe(4)
    expect(noteFinger({ Fingering: { value: '4-3' } })).toBe(4)
    expect(noteFinger({ Fingering: { value: '1-2-3' } })).toBe(1)
  })

  // All three shapes occur in the local corpus. Unlike "43" they name no
  // striking finger to fall back on -- the circled form alone means an
  // alternative, a substitution or the other hand depending on the edition --
  // so a number under a key would be a guess dressed as an instruction.
  it('refuses a value it cannot read as one piano finger', () => {
    expect(noteFinger({ Fingering: { value: '\u2463' } })).toBeNull()
    expect(noteFinger({ Fingering: { value: '(4-5)' } })).toBeNull()
    expect(noteFinger({ Fingering: { value: 'etc.' } })).toBeNull()
    expect(noteFinger({ Fingering: { value: '0' } })).toBeNull()
    expect(noteFinger({ Fingering: { value: '6' } })).toBeNull()
    expect(noteFinger({ Fingering: { value: '3rd' } })).toBeNull()
  })
})
