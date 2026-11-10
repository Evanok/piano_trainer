import { describe, expect, it } from 'vitest'
import { compositeOrder, createPolyrhythmExercise, POLYRHYTHM_RATIO_ORDER, POLYRHYTHM_RATIOS } from './polyrhythmGenerator'
import type { PolyrhythmPitches } from '../types/training'

const PITCHES: PolyrhythmPitches[] = ['single', 'broken']
const KEYS = ['C', 'G', 'D', 'A', 'F', 'B-flat', 'E-flat']

/** Sum of <duration> per voice per measure. */
function measureTotals(xml: string): number[][] {
  return xml
    .split('<measure ')
    .slice(1)
    .map((measure) => {
      const byVoice = new Map<string, number>()
      for (const note of measure.split('<note>').slice(1)) {
        const voice = /<voice>(\d)<\/voice>/.exec(note)?.[1] ?? '1'
        const duration = Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1])
        byVoice.set(voice, (byVoice.get(voice) ?? 0) + duration)
      }
      return [...byVoice.values()]
    })
}

/** Where each note of one hand starts in the measure, in divisions (12 per quarter). */
function onsets(notes: { duration: number }[]): number[] {
  let position = 0
  return notes.map((note) => {
    const start = position
    position += note.duration
    return start
  })
}

describe('createPolyrhythmExercise', () => {
  it('fills every measure of both hands exactly, for every ratio, pitch mode and key', async () => {
    for (const ratio of POLYRHYTHM_RATIO_ORDER) {
      for (const pitches of PITCHES) {
        for (const key of KEYS) {
          const exercise = createPolyrhythmExercise({ ratio, pitches, key, measureCount: 9 }, key)
          const totals = measureTotals(await exercise.file.text())
          expect(totals).toHaveLength(9)
          for (const voices of totals) {
            expect(voices).toEqual([48, 48])
          }
        }
      }
    }
  })

  it('splits every beat into the ratio, so the hands meet only on the beat', () => {
    for (const ratio of POLYRHYTHM_RATIO_ORDER) {
      const { right, left } = POLYRHYTHM_RATIOS[ratio]
      const exercise = createPolyrhythmExercise({ ratio, measureCount: 4 }, ratio)
      const measure = exercise.measures[0]
      expect(measure.right).toHaveLength(4 * right)
      expect(measure.left).toHaveLength(4 * left)
      const rightOnsets = new Set(onsets(measure.right))
      const shared = onsets(measure.left).filter((start) => rightOnsets.has(start))
      expect(shared).toEqual([0, 12, 24, 36])
    }
  })

  it('writes triplets with a time modification and one tuplet start and stop per beat', async () => {
    const xml = await createPolyrhythmExercise({ ratio: '3:2', measureCount: 4 }, 'xml').file.text()
    const firstMeasure = xml.split('<measure ')[1]
    expect(firstMeasure.match(/<actual-notes>3<\/actual-notes>/g)).toHaveLength(12)
    expect(firstMeasure.match(/<tuplet type="start"/g)).toHaveLength(4)
    expect(firstMeasure.match(/<tuplet type="stop"/g)).toHaveLength(4)
    // Eight eighths in the left hand, beamed in pairs.
    expect(firstMeasure.match(/<beam number="1">begin<\/beam>/g)).toHaveLength(8)
    expect(firstMeasure).not.toContain('<accidental>')

    const sixteenths = await createPolyrhythmExercise({ ratio: '3:4', measureCount: 4 }, 'xml').file.text()
    expect(sixteenths.split('<measure ')[1].match(/<beam number="2">begin<\/beam>/g)).toHaveLength(4)
  })

  it('keeps each hand on its own staff, on notes of the key', () => {
    for (const ratio of POLYRHYTHM_RATIO_ORDER) {
      for (const pitches of PITCHES) {
        for (const key of KEYS) {
          const exercise = createPolyrhythmExercise({ ratio, pitches, key, measureCount: 8 }, key)
          const scalePcs = new Set(
            exercise.measures.flatMap((measure) => [...measure.right, ...measure.left]).map((note) => note.pitch.midi % 12),
          )
          expect(scalePcs.size).toBeLessThanOrEqual(7)
          for (const measure of exercise.measures) {
            for (const note of measure.right) {
              expect(note.pitch.midi).toBeGreaterThanOrEqual(60)
              expect(note.pitch.midi).toBeLessThanOrEqual(81)
            }
            for (const note of measure.left) {
              expect(note.pitch.midi).toBeGreaterThanOrEqual(40)
              expect(note.pitch.midi).toBeLessThanOrEqual(64)
            }
          }
        }
      }
    }
  })

  it('walks I IV V I and closes on the tonic in both hands', () => {
    const exercise = createPolyrhythmExercise({ ratio: '2:3', pitches: 'single', key: 'C', measureCount: 6 }, 'c')
    expect(exercise.measures.map((measure) => measure.chordDegree)).toEqual([0, 3, 4, 0, 0, 0])
    expect(exercise.measures[1].right.every((note) => note.pitch.step === 'F')).toBe(true)
    expect(exercise.measures[2].left.every((note) => note.pitch.step === 'G')).toBe(true)
    const last = exercise.measures[5]
    expect(last.right).toHaveLength(1)
    expect(last.left).toHaveLength(1)
    expect(last.right[0].pitch.step).toBe('C')
    expect(last.left[0].pitch.step).toBe('C')
  })

  it('rocks the broken chord up on odd beats and down on even ones', () => {
    const exercise = createPolyrhythmExercise({ ratio: '3:2', pitches: 'broken', key: 'C', measureCount: 4 }, 'b')
    const steps = exercise.measures[0].right.map((note) => note.pitch.step)
    expect(steps).toEqual(['C', 'E', 'G', 'G', 'E', 'C', 'C', 'E', 'G', 'G', 'E', 'C'])
  })

  it('spells the composite rhythm of one beat', () => {
    expect(compositeOrder('3:2')).toEqual(['together', 'right', 'left', 'right'])
    expect(compositeOrder('2:3')).toEqual(['together', 'left', 'right', 'left'])
    expect(compositeOrder('3:4')).toEqual(['together', 'left', 'right', 'left', 'right', 'left'])
  })
})
