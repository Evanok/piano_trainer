import { describe, expect, it } from 'vitest'
import { extractTriads, triadOf } from './scoreChords.ts'

const note = (step: string, octave: number, alter = 0) => ({
  step,
  alter,
  midi: (octave + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step]! + alter,
})

describe('triadOf', () => {
  it('names the root, the spelling and the bottom tone of a stack', () => {
    expect(triadOf([note('E', 4), note('G', 4), note('C', 5)])).toEqual({
      rootStep: 'C',
      alters: [0, 0, 0],
      quality: 'major',
      inversion: 1,
    })
    expect(triadOf([note('A', 3), note('D', 4), note('F', 4, 1)])).toMatchObject({
      rootStep: 'D',
      quality: 'major',
      inversion: 2,
    })
  })

  it('accepts doublings, which are still the same three-letter chord', () => {
    expect(triadOf([note('G', 2), note('G', 3), note('B', 3), note('D', 4)])).toMatchObject({
      rootStep: 'G',
      inversion: 0,
    })
  })

  it('refuses anything that is not exactly a stacked triad', () => {
    // A seventh chord, a stack of seconds, and one letter under two accidentals.
    expect(triadOf([note('G', 3), note('B', 3), note('D', 4), note('F', 4)])).toBeNull()
    expect(triadOf([note('C', 4), note('D', 4), note('E', 4)])).toBeNull()
    expect(triadOf([note('C', 4), note('E', 4), note('G', 4), note('G', 4, 1)])).toBeNull()
    // Spelled as a stack but not one of the four qualities (do mi♭ sol♯).
    expect(triadOf([note('C', 4), note('E', 4, -1), note('G', 4, 1)])).toBeNull()
  })
})

function measure(content: string): string {
  return `<measure number="1">${content}</measure>`
}

function noteXml(step: string, octave: number, options: { chord?: boolean; alter?: number; extra?: string } = {}): string {
  return `<note>${options.chord ? '<chord/>' : ''}<pitch><step>${step}</step>${
    options.alter ? `<alter>${options.alter}</alter>` : ''
  }<octave>${octave}</octave></pitch><duration>4</duration>${options.extra ?? ''}</note>`
}

const stack = (...notes: Array<[string, number, number?]>) =>
  notes.map(([step, octave, alter], index) => noteXml(step, octave, { chord: index > 0, alter })).join('')

describe('extractTriads', () => {
  it('reads each stack with the signature and measure it is written in', () => {
    const xml = `<part id="P1">${measure(
      `<attributes><key><fifths>-1</fifths></key></attributes>${stack(['F', 4], ['A', 4], ['C', 5])}`,
    )}${measure(stack(['B', 3, -1], ['D', 4], ['F', 4]))}</part>`
    expect(extractTriads(xml)).toEqual([
      { rootStep: 'F', alters: [0, 0, 0], quality: 'major', inversion: 0, measure: 1, fifths: -1 },
      { rootStep: 'B', alters: [-1, 0, 0], quality: 'major', inversion: 0, measure: 2, fifths: -1 },
    ])
  })

  it('never merges notes that are not one stack', () => {
    // Three single notes in a row, and a stack split by a backup across staves.
    const xml = `<part id="P1">${measure(
      `${noteXml('C', 4)}${noteXml('E', 4)}${noteXml('G', 4)}${noteXml('C', 3)}${noteXml('E', 3, { chord: true })}<backup><duration>4</duration></backup>${noteXml('G', 3, { chord: true })}`,
    )}</part>`
    expect(extractTriads(xml)).toEqual([])
  })

  it('leaves grace notes out of the harmony', () => {
    const xml = `<part id="P1">${measure(
      `${noteXml('C', 4)}${noteXml('E', 4, { chord: true })}${noteXml('G', 4, { chord: true })}${noteXml('B', 4, { chord: true, extra: '<grace/>' })}`,
    )}</part>`
    expect(extractTriads(xml)).toHaveLength(1)
  })

  it('keeps one copy of a chord a piece repeats', () => {
    const chord = stack(['C', 4], ['E', 4], ['G', 4])
    const xml = `<part id="P1">${measure(chord + chord)}${measure(chord)}</part>`
    expect(extractTriads(xml)).toHaveLength(1)
  })
})
