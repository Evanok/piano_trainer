import { describe, expect, it } from 'vitest'
import {
  MAX_BPM,
  MIN_BPM,
  TAP_RESET_MS,
  beatIntervalSeconds,
  bpmAtPercent,
  clampBpm,
  scoreTempoInCountedUnit,
  beatAccent,
  isCompoundMeter,
  parseMeter,
  resolveMeter,
  recentTaps,
  tapTempoBpm,
} from './metronome'

describe('clampBpm', () => {
  it('keeps the tempo inside the supported range and rounds it', () => {
    expect(clampBpm(10)).toBe(MIN_BPM)
    expect(clampBpm(500)).toBe(MAX_BPM)
    expect(clampBpm(92.6)).toBe(93)
  })

  it('falls back to the default on a non-number', () => {
    expect(clampBpm(Number.NaN)).toBe(80)
  })
})

describe('beatIntervalSeconds', () => {
  it('is one second at 60 bpm and half a second at 120', () => {
    expect(beatIntervalSeconds(60)).toBe(1)
    expect(beatIntervalSeconds(120)).toBe(0.5)
  })
})

describe('beatAccent', () => {
  it('accents the first beat of every bar in a simple meter', () => {
    const meter = { numerator: 3, denominator: 4 }
    expect([0, 1, 2, 3, 4, 5].map((beat) => beatAccent(beat, meter))).toEqual([
      'strong',
      'weak',
      'weak',
      'strong',
      'weak',
      'weak',
    ])
  })

  it('counts 6/8 in eighths with a lighter accent on the fourth', () => {
    const meter = { numerator: 6, denominator: 8 }
    expect([0, 1, 2, 3, 4, 5, 6].map((beat) => beatAccent(beat, meter))).toEqual([
      'strong',
      'weak',
      'weak',
      'medium',
      'weak',
      'weak',
      'strong',
    ])
  })

  it('clicks every beat the same without a meter', () => {
    expect([0, 1, 2].map((beat) => beatAccent(beat, null))).toEqual(['strong', 'strong', 'strong'])
  })
})

describe('meters', () => {
  it('parses a written signature and rejects anything else', () => {
    expect(parseMeter('6/8')).toEqual({ numerator: 6, denominator: 8 })
    expect(parseMeter('score')).toBeNull()
    expect(parseMeter('0/4')).toBeNull()
  })

  it('treats only 6/8, 9/8, 12/8 as compound', () => {
    expect(isCompoundMeter({ numerator: 6, denominator: 8 })).toBe(true)
    expect(isCompoundMeter({ numerator: 12, denominator: 8 })).toBe(true)
    expect(isCompoundMeter({ numerator: 3, denominator: 8 })).toBe(false)
    expect(isCompoundMeter({ numerator: 6, denominator: 4 })).toBe(false)
  })

  it('follows the score unless a signature is forced', () => {
    const score = { numerator: 3, denominator: 4 }
    expect(resolveMeter('score', score)).toEqual(score)
    expect(resolveMeter('score', null)).toBeNull()
    expect(resolveMeter('none', score)).toBeNull()
    expect(resolveMeter('6/8', score)).toEqual({ numerator: 6, denominator: 8 })
  })
})

describe('tapTempoBpm', () => {
  it('needs two taps', () => {
    expect(tapTempoBpm([])).toBeNull()
    expect(tapTempoBpm([1000])).toBeNull()
  })

  it('averages the gaps between taps', () => {
    expect(tapTempoBpm([0, 500, 1000, 1500])).toBe(120)
    expect(tapTempoBpm([0, 1000])).toBe(60)
  })

  it('starts over after a pause', () => {
    const taps = [0, 300, 600, 600 + TAP_RESET_MS + 1, 600 + TAP_RESET_MS + 1001]
    expect(recentTaps(taps)).toEqual([600 + TAP_RESET_MS + 1, 600 + TAP_RESET_MS + 1001])
    expect(tapTempoBpm(taps)).toBe(60)
  })

  it('only keeps the last few taps so a tempo change is followed', () => {
    const slow = [0, 1000, 2000, 3000, 4000, 5000]
    const fast = [5500, 6000, 6500, 7000, 7500]
    expect(tapTempoBpm([...slow, ...fast])).toBeGreaterThan(100)
  })
})

describe('score tempo', () => {
  it('counts the score tempo in the meter unit', () => {
    expect(scoreTempoInCountedUnit(120, { numerator: 4, denominator: 4 })).toBe(120)
    // 6/8 at dotted quarter = 60 is 90 quarters, 180 eighths.
    expect(scoreTempoInCountedUnit(90, { numerator: 6, denominator: 8 })).toBe(180)
    expect(scoreTempoInCountedUnit(120, { numerator: 2, denominator: 2 })).toBe(60)
    expect(scoreTempoInCountedUnit(100, null)).toBe(100)
  })

  it('takes a rounded, clamped share of it', () => {
    expect(bpmAtPercent(120, 70)).toBe(84)
    expect(bpmAtPercent(100, 100)).toBe(100)
    expect(bpmAtPercent(40, 50)).toBe(MIN_BPM)
  })
})
