import { describe, expect, it } from 'vitest'
import { createTrainingExercise, generateTrainingMusicXml } from './trainingGenerator'

describe('generateTrainingMusicXml', () => {
  it('is deterministic for the same settings and seed', () => {
    const settings = {
      handMode: 'right' as const,
      accidentalMode: 'key' as const,
      difficulty: 'medium' as const,
      seed: 'daily',
    }

    expect(generateTrainingMusicXml(settings)).toBe(generateTrainingMusicXml(settings))
  })

  it('generates a one-staff right-hand score by default', () => {
    const xml = generateTrainingMusicXml({ measureCount: 4, seed: 'right' })

    expect(xml).toContain('<work-title>Right-hand training')
    expect(xml).toContain('<sign>G</sign>')
    expect(xml).not.toContain('<staves>2</staves>')
    expect((xml.match(/<measure number="/g) ?? [])).toHaveLength(4)
    expect((xml.match(/<note>/g) ?? [])).toHaveLength(16)
  })

  it('generates two synchronized staves for both hands', () => {
    const xml = generateTrainingMusicXml({ handMode: 'both', measureCount: 8, seed: 'both' })

    expect(xml).toContain('<staves>2</staves>')
    expect(xml).toContain('<clef number="1">')
    expect(xml).toContain('<clef number="2">')
    expect((xml.match(/<backup>/g) ?? [])).toHaveLength(8)
    expect((xml.match(/<note>/g) ?? [])).toHaveLength(64)
  })

  it('returns key metadata for generated backing tracks', () => {
    const exercise = createTrainingExercise({ accidentalMode: 'none', seed: 'metadata' })

    expect(exercise.keyName).toBe('C major')
    expect(exercise.tonicPitchClass).toBe(0)
    expect(exercise.file.name).toMatch(/training-exercise-.*\.musicxml/)
  })

  it('resolves generated right-hand phrases back to the tonic', () => {
    const xml = generateTrainingMusicXml({
      accidentalMode: 'none',
      difficulty: 'medium',
      measureCount: 8,
      seed: 'cadence',
    })

    const steps = Array.from(xml.matchAll(new RegExp('<step>([A-G])</step>', 'g')))
    expect(steps.at(-1)?.[1]).toBe('C')
  })

  it('can include accidentals when chromatic mode is selected', () => {
    const xml = generateTrainingMusicXml({
      accidentalMode: 'chromatic',
      difficulty: 'hard',
      measureCount: 16,
      seed: 'accidentals',
    })

    expect(xml).toMatch(/<alter>-?1<\/alter>/)
  })
})
