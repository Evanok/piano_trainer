import { describe, expect, it } from 'vitest'
import { mergeWithDefaults } from './preferencesStore'

const DEFAULTS = { mode: 'notes', count: 20, enabled: false, steps: ['root'] as string[] }

describe('mergeWithDefaults', () => {
  it('returns the defaults when nothing was stored', () => {
    expect(mergeWithDefaults(DEFAULTS, null)).toEqual(DEFAULTS)
    expect(mergeWithDefaults(DEFAULTS, undefined)).toEqual(DEFAULTS)
  })

  it('keeps every stored field that still has the expected type', () => {
    expect(mergeWithDefaults(DEFAULTS, { mode: 'triads', count: 40, enabled: true, steps: ['root', 'play'] })).toEqual({
      mode: 'triads',
      count: 40,
      enabled: true,
      steps: ['root', 'play'],
    })
  })

  it('fills a field added since the value was stored from the defaults', () => {
    expect(mergeWithDefaults(DEFAULTS, { mode: 'triads' })).toEqual({ ...DEFAULTS, mode: 'triads' })
  })

  it('replaces only the field whose type changed, not the whole object', () => {
    expect(mergeWithDefaults(DEFAULTS, { mode: 3, count: 10, steps: 'root' })).toEqual({ ...DEFAULTS, count: 10 })
  })

  it('drops fields the defaults no longer have', () => {
    expect(mergeWithDefaults(DEFAULTS, { removed: 'x' })).toEqual(DEFAULTS)
  })

  it('rejects a stored value of the wrong shape altogether', () => {
    expect(mergeWithDefaults(DEFAULTS, 'garbage')).toEqual(DEFAULTS)
    expect(mergeWithDefaults(DEFAULTS, [1, 2])).toEqual(DEFAULTS)
    expect(mergeWithDefaults('generated', 7)).toBe('generated')
    expect(mergeWithDefaults('generated', 'chords')).toBe('chords')
  })
})
