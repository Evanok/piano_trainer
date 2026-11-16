import { describe, expect, it } from 'vitest'
import {
  MAX_BPM,
  MIN_BPM,
  TAP_RESET_MS,
  beatIntervalSeconds,
  clampBpm,
  isAccentBeat,
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

describe('isAccentBeat', () => {
  it('accents the first beat of every bar', () => {
    expect([0, 1, 2, 3, 4, 5].map((beat) => isAccentBeat(beat, 3))).toEqual([true, false, false, true, false, false])
  })

  it('accents nothing without a bar length', () => {
    expect(isAccentBeat(0, 0)).toBe(false)
    expect(isAccentBeat(4, 0)).toBe(false)
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
