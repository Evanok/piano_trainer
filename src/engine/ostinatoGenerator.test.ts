import { describe, expect, it } from 'vitest'
import { createOstinatoExercise, OSTINATO_PATTERN_ORDER, OSTINATO_PATTERNS } from './ostinatoGenerator'
import type { OstinatoMelodyRhythm } from '../types/training'

const RHYTHMS: OstinatoMelodyRhythm[] = ['easy', 'medium', 'hard']
const KEYS = ['C', 'G', 'D', 'A', 'F', 'B-flat', 'E-flat']

/** Sum of <duration> per voice per measure, chord tones excluded. */
function measureTotals(xml: string): number[][] {
  return xml
    .split('<measure ')
    .slice(1)
    .map((measure) => {
      const byVoice = new Map<string, number>()
      for (const note of measure.split('<note>').slice(1)) {
        if (note.includes('<chord/>')) {
          continue
        }
        const voice = /<voice>(\d)<\/voice>/.exec(note)?.[1] ?? '1'
        const duration = Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1])
        byVoice.set(voice, (byVoice.get(voice) ?? 0) + duration)
      }
      return [...byVoice.values()]
    })
}

describe('createOstinatoExercise', () => {
  it('fills every measure of both hands exactly, for every pattern, rhythm and key', async () => {
    for (const pattern of OSTINATO_PATTERN_ORDER) {
      for (const melodyRhythm of RHYTHMS) {
        for (const key of KEYS) {
          const exercise = createOstinatoExercise({ pattern, melodyRhythm, key, measureCount: 12 }, `${pattern}-${key}`)
          const totals = measureTotals(await exercise.file.text())
          expect(totals).toHaveLength(12)
          for (const voices of totals) {
            expect(voices).toEqual([16, 16])
          }
        }
      }
    }
  })

  it('walks the boogie bass with a flat seventh spelled on the right letter', () => {
    const exercise = createOstinatoExercise({ pattern: 'boogie', key: 'C', measureCount: 12 }, 'boogie')
    const spelled = (index: number) =>
      exercise.measures[index].left.map((event) => `${event.pitch!.step}${event.pitch!.alter ?? 0}`)
    // Bar 1 is C, bar 5 is F, bar 9 is G in a twelve-bar blues.
    expect(spelled(0)).toEqual(['C0', 'E0', 'G0', 'A0', 'B-1', 'A0', 'G0', 'E0'])
    expect(spelled(4)).toEqual(['F0', 'A0', 'C0', 'D0', 'E-1', 'D0', 'C0', 'A0'])
    expect(spelled(8)).toEqual(['G0', 'B0', 'D0', 'E0', 'F0', 'E0', 'D0', 'B0'])
  })

  it('keeps the bass on the bass staff and the melody on the treble staff', () => {
    for (const pattern of OSTINATO_PATTERN_ORDER) {
      for (const key of KEYS) {
        const exercise = createOstinatoExercise({ pattern, key, melodyRhythm: 'hard', measureCount: 16 }, key)
        for (const measure of exercise.measures) {
          for (const event of measure.left) {
            expect(event.pitch!.midi).toBeGreaterThanOrEqual(40)
            expect(event.pitch!.midi).toBeLessThanOrEqual(64)
          }
          for (const event of measure.right) {
            if (event.pitch) {
              expect(event.pitch.midi).toBeGreaterThanOrEqual(60)
              expect(event.pitch.midi).toBeLessThanOrEqual(79)
            }
          }
        }
      }
    }
  })

  it('follows the pattern\'s own progression and ends on the tonic', () => {
    const exercise = createOstinatoExercise({ pattern: 'alberti', measureCount: 8 }, 'progression')
    expect(exercise.measures.slice(0, 7).map((measure) => measure.chordDegree)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((index) => OSTINATO_PATTERNS.alberti.progression[index % 4]),
    )
    const last = exercise.measures[7]
    expect(last.left).toHaveLength(1)
    expect(last.right).toHaveLength(1)
    expect(last.right[0].pitch!.midi % 12).toBe(0)
  })

  it('writes the dotted rhythms and off-beat entries only from the hard melody', () => {
    const collect = (melodyRhythm: OstinatoMelodyRhythm) => {
      const durations = new Set<number>()
      let rests = 0
      for (let seed = 0; seed < 10; seed += 1) {
        const exercise = createOstinatoExercise({ melodyRhythm, measureCount: 16 }, String(seed))
        for (const measure of exercise.measures) {
          for (const event of measure.right) {
            durations.add(event.duration)
            rests += event.pitch ? 0 : 1
          }
        }
      }
      return { durations, rests }
    }
    const easy = collect('easy')
    expect([...easy.durations].every((duration) => duration >= 4)).toBe(true)
    expect(easy.rests).toBe(0)
    const hard = collect('hard')
    expect(hard.durations.has(3)).toBe(true)
    expect(hard.durations.has(1)).toBe(true)
    expect(hard.rests).toBeGreaterThan(0)
  })

  it('beams eighths per beat and prints a sign only where the key does not carry it', async () => {
    const exercise = createOstinatoExercise({ pattern: 'boogie', key: 'F', measureCount: 12 }, 'beams')
    const xml = await exercise.file.text()
    expect(xml).toContain('<beam number="1">begin</beam>')
    const bars = xml.split('<measure ').slice(1)
    const bass = (bar: number) => bars[bar].split('<backup>')[1]
    // F major's IV is B-flat, whose flat seventh is A-flat: a sign the key
    // does not carry, printed once.
    expect(bass(4).match(/<accidental>flat<\/accidental>/g)).toHaveLength(1)
    // On I (F) the flat seventh is E-flat; on V (C) it is B-flat, which the
    // key already carries, so that bar prints no sign at all.
    expect(bass(0)).toContain('<accidental>flat</accidental>')
    expect(bass(8)).not.toContain('<accidental>')
  })

  it('cancels an earlier sign with a natural in the same measure', async () => {
    // The dotted boogie on C in C major: B-flat, then nothing else on B. The
    // alberti on V in F major: E natural is in the key. Neither needs one, so
    // the check is that a whole round never prints a sign the bar did not need:
    // every accidental names a change from what is in force.
    for (const key of ['C', 'G', 'D', 'A', 'F', 'B-flat', 'E-flat']) {
      const exercise = createOstinatoExercise({ pattern: 'boogie', key, melodyRhythm: 'hard', measureCount: 24 }, key)
      const xml = await exercise.file.text()
      for (const bar of xml.split('<measure ').slice(1)) {
        for (const staff of bar.split('<backup>')) {
          const seen = new Map<string, number>()
          for (const note of staff.split('<note>').slice(1)) {
            const step = /<step>(\w)<\/step>/.exec(note)?.[1]
            if (!step) continue
            const octave = /<octave>(\d)<\/octave>/.exec(note)?.[1]
            const alter = Number(/<alter>(-?\d)<\/alter>/.exec(note)?.[1] ?? 0)
            const sign = /<accidental>([\w-]+)<\/accidental>/.exec(note)?.[1]
            const place = `${step}${octave}`
            if (seen.has(place) && seen.get(place) === alter) {
              expect(sign).toBeUndefined()
            }
            if (seen.has(place) && seen.get(place) !== alter) {
              expect(sign).toBeDefined()
            }
            seen.set(place, alter)
          }
        }
      }
    }
  })
})
