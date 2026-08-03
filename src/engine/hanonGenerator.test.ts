import { describe, expect, it } from 'vitest'
import {
  createHanonExercise,
  generateHanonMusicXml,
  hanonMeasures,
  hanonMidiNotes,
  hanonMidiRange,
  isHanonRangePlayable,
  sanitizeHanonSettings,
} from './hanonGenerator'
import { HANON_EXERCISE_NUMBERS, HANON_NOTES_PER_MEASURE, hanonPattern } from './hanonPatterns'

describe('hanonMeasures', () => {
  it('states exercise 1 as the printed figure walking up the scale', () => {
    const measures = hanonMeasures(sanitizeHanonSettings({ exerciseNumber: 1 }))
    expect(measures[0]).toEqual([0, 2, 3, 4, 5, 4, 3, 2])
    expect(measures[1]).toEqual([1, 3, 4, 5, 6, 5, 4, 3])
    expect(measures[13]).toEqual([13, 15, 16, 17, 18, 17, 16, 15])
    // The turnaround: the descending half restates the figure inverted.
    expect(measures[14]).toEqual([18, 16, 15, 14, 13, 14, 15, 16])
  })

  it('fills every measure but the closing tonic', () => {
    for (const number of HANON_EXERCISE_NUMBERS) {
      const measures = hanonMeasures(sanitizeHanonSettings({ exerciseNumber: number }))
      const lengths = new Set(measures.slice(0, -1).map((measure) => measure.length))
      expect(lengths, `exercise ${number}`).toEqual(new Set([HANON_NOTES_PER_MEASURE]))
      expect(measures[measures.length - 1], `exercise ${number}`).toEqual([0])
    }
  })

  it('stops at the turnaround for an ascending-only run', () => {
    const full = hanonMeasures(sanitizeHanonSettings({ exerciseNumber: 1, length: 'full' }))
    const ascending = hanonMeasures(sanitizeHanonSettings({ exerciseNumber: 1, length: 'ascending' }))
    expect(ascending.length).toBe(15) // 14 measures up, then the closing tonic
    expect(ascending.slice(0, -1)).toEqual(full.slice(0, ascending.length - 1))
  })
})

describe('hanonMidiNotes', () => {
  it('matches the printed C major original for exercise 1', () => {
    const notes = hanonMidiNotes({ exerciseNumber: 1 })
    // C4 E4 F4 G4 A4 G4 F4 E4, then the same figure a step higher.
    expect(notes.slice(0, 8)).toEqual([60, 64, 65, 67, 69, 67, 65, 64])
    expect(notes.slice(8, 16)).toEqual([62, 65, 67, 69, 71, 69, 67, 65])
    expect(notes[notes.length - 1]).toBe(60)
  })

  it('doubles the left hand exactly one octave below the right', () => {
    for (const number of HANON_EXERCISE_NUMBERS) {
      const right = hanonMidiNotes({ exerciseNumber: number }, 'right')
      const left = hanonMidiNotes({ exerciseNumber: number }, 'left')
      expect(left, `exercise ${number}`).toEqual(right.map((midi) => midi - 12))
    }
  })

  it('stays diatonic when transposed, and starts on the new tonic', () => {
    const notes = hanonMidiNotes({ exerciseNumber: 1, key: 'B-flat' })
    expect(notes[0]).toBe(70) // B-flat 4
    const bFlatMajorPcs = new Set([10, 0, 2, 3, 5, 7, 9])
    for (const midi of notes) {
      expect(bFlatMajorPcs.has(midi % 12)).toBe(true)
    }
  })

  it('shifts every note by whole octaves', () => {
    const base = hanonMidiNotes({ exerciseNumber: 7 })
    expect(hanonMidiNotes({ exerciseNumber: 7, octaveShift: -1 })).toEqual(base.map((midi) => midi - 12))
  })
})

describe('generateHanonMusicXml', () => {
  it('notates sixteenths in 2/4 with beams', () => {
    const xml = generateHanonMusicXml({ exerciseNumber: 1, handMode: 'right' })
    expect(xml).toContain('<divisions>4</divisions>')
    expect(xml).toContain('<beats>2</beats>')
    expect(xml).toContain('<type>16th</type>')
    expect(xml).toContain('<beam number="1">begin</beam>')
    expect(xml).toContain('<beam number="1">end</beam>')
    // The closing tonic fills its own measure instead of being a lone sixteenth.
    expect(xml).toContain('<type>half</type>')
  })

  it('writes two staves and a backup only for two-hand exercises', () => {
    const both = generateHanonMusicXml({ exerciseNumber: 1, handMode: 'both' })
    expect(both).toContain('<staves>2</staves>')
    expect(both).toContain('<backup>')
    expect(both).toContain('<staff>2</staff>')

    const right = generateHanonMusicXml({ exerciseNumber: 1, handMode: 'right' })
    expect(right).not.toContain('<staves>2</staves>')
    expect(right).not.toContain('<backup>')
  })

  it('spells a transposed exercise with the key signature, not accidentals', () => {
    const xml = generateHanonMusicXml({ exerciseNumber: 1, key: 'B-flat', handMode: 'right' })
    expect(xml).toContain('<fifths>-2</fifths>')
    expect(xml).toContain('<step>B</step>\n          <alter>-1</alter>')
    expect(xml).not.toContain('<alter>1</alter>')
  })

  it('names the piece after the exercise so exercise history is readable', () => {
    expect(generateHanonMusicXml({ exerciseNumber: 12 })).toContain(
      '<work-title>Hanon No. 12 - C major</work-title>',
    )
    expect(generateHanonMusicXml({ exerciseNumber: 3, length: 'ascending' })).toContain(
      '<work-title>Hanon No. 3 - C major (ascending)</work-title>',
    )
  })

  // OSMD does not throw on a measure whose durations do not add up -- it renders
  // something wrong instead -- so the arithmetic is checked here rather than
  // being discovered by eye on the sheet.
  it('fills every measure of every exercise exactly, on both staves', () => {
    for (const number of HANON_EXERCISE_NUMBERS) {
      const xml = generateHanonMusicXml({ exerciseNumber: number, handMode: 'both' })
      const measures = xml.split('<measure number=').slice(1)
      measures.forEach((measure, index) => {
        const perVoice = new Map<string, number>()
        for (const note of measure.match(/<note>[\s\S]*?<\/note>/g) ?? []) {
          const voice = note.match(/<voice>(\d+)<\/voice>/)![1]
          const duration = Number(note.match(/<duration>(\d+)<\/duration>/)![1])
          perVoice.set(voice, (perVoice.get(voice) ?? 0) + duration)
        }
        const where = `exercise ${number}, measure ${index + 1}`
        expect([...perVoice.keys()].sort(), where).toEqual(['1', '2'])
        // 2/4 at 4 divisions per quarter.
        expect(perVoice.get('1'), where).toBe(8)
        expect(perVoice.get('2'), where).toBe(8)
        // The backup has to rewind the full measure, or the left hand starts late.
        expect(measure.match(/<backup>\s*<duration>8<\/duration>/), where).not.toBeNull()
      })
    }
  })

  it('opens and closes every beam group', () => {
    const xml = generateHanonMusicXml({ exerciseNumber: 1, handMode: 'both' })
    for (const measure of xml.split('<measure number=').slice(1, -1)) {
      const beams = measure.match(/<beam number="1">(\w+)<\/beam>/g) ?? []
      const count = (kind: string) => beams.filter((beam) => beam.includes(`>${kind}<`)).length
      // Two groups of four sixteenths per hand, both hands playing.
      expect(count('begin')).toBe(4)
      expect(count('continue')).toBe(8)
      expect(count('end')).toBe(4)
    }
  })

  it('produces one measure element per generated measure for every exercise', () => {
    for (const number of HANON_EXERCISE_NUMBERS) {
      const xml = generateHanonMusicXml({ exerciseNumber: number })
      const measureCount = xml.match(/<measure number=/g)?.length ?? 0
      expect(measureCount, `exercise ${number}`).toBe(hanonMeasures(sanitizeHanonSettings({ exerciseNumber: number })).length)
    }
  })
})

describe('hanonMidiRange', () => {
  it('spans both hands for a two-hand exercise', () => {
    const range = hanonMidiRange({ exerciseNumber: 1, handMode: 'both' })
    expect(range.high).toBe(91) // G6, the top of the printed exercise
    expect(range.low).toBe(47) // B2, an octave below the right hand's lowest
  })

  it('reports only the played hand when one hand is selected', () => {
    expect(hanonMidiRange({ exerciseNumber: 1, handMode: 'right' }).low).toBe(59)
    expect(hanonMidiRange({ exerciseNumber: 1, handMode: 'left' }).high).toBe(79)
  })

  it('rejects a shift that would run off the end of the keyboard', () => {
    // The exercise already reaches G6, so shifting up two octaves leaves the
    // top of an 88-key piano; the bottom still fits at the lowest shift.
    expect(isHanonRangePlayable({ exerciseNumber: 1, handMode: 'both', octaveShift: 0 })).toBe(true)
    expect(isHanonRangePlayable({ exerciseNumber: 1, handMode: 'both', octaveShift: -2 })).toBe(true)
    expect(isHanonRangePlayable({ exerciseNumber: 1, handMode: 'both', octaveShift: 2 })).toBe(false)
  })
})

describe('sanitizeHanonSettings', () => {
  it('keeps the exercise number and shift inside the supported range', () => {
    expect(sanitizeHanonSettings({ exerciseNumber: 0 }).exerciseNumber).toBe(1)
    expect(sanitizeHanonSettings({ exerciseNumber: 99 }).exerciseNumber).toBe(20)
    expect(sanitizeHanonSettings({ octaveShift: 9 }).octaveShift).toBe(2)
  })

  it('falls back to exercise 1 for an unknown number', () => {
    expect(hanonPattern(999).number).toBe(1)
  })
})

describe('createHanonExercise', () => {
  it('hands App a .musicxml File plus the key it was built in', () => {
    const exercise = createHanonExercise({ exerciseNumber: 5, key: 'G' })
    expect(exercise.file.name).toMatch(/^hanon-5-\d{4}-\d{2}-\d{2}\.musicxml$/)
    expect(exercise.keyName).toBe('G major')
    expect(exercise.tonicPitchClass).toBe(7)
    expect(exercise.accidentalsLabel).toBe('Sharps: F♯')
    expect(exercise.measureCount).toBe(29)
  })
})
