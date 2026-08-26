import { describe, expect, it } from 'vitest'
import { isAllowedForGuest } from './catalogApi.ts'

/**
 * The read-only boundary of a share link. Everything else about the API is
 * exercised through its stores; this is the one decision worth pinning down on
 * its own, since getting it wrong hands a guest the write endpoints.
 */
describe('isAllowedForGuest', () => {
  it('allows browsing the catalog, opening a score and reading the history', () => {
    expect(isAllowedForGuest('GET', '/api/scores')).toBe(true)
    expect(isAllowedForGuest('GET', '/api/scores/2a1c4f6e-0000-4000-8000-000000000000/file')).toBe(true)
    expect(isAllowedForGuest('GET', '/api/stats')).toBe(true)
  })

  it('refuses every write, including the stats sync a guest device would otherwise attempt', () => {
    expect(isAllowedForGuest('POST', '/api/stats/sync')).toBe(false)
    expect(isAllowedForGuest('POST', '/api/scores')).toBe(false)
    expect(isAllowedForGuest('PATCH', '/api/scores/2a1c4f6e-0000-4000-8000-000000000000')).toBe(false)
    expect(isAllowedForGuest('DELETE', '/api/scores/2a1c4f6e-0000-4000-8000-000000000000')).toBe(false)
  })

  it('is an allowlist, so an endpoint nobody thought about is closed by default', () => {
    expect(isAllowedForGuest('GET', '/api/something-new')).toBe(false)
    expect(isAllowedForGuest(undefined, '/api/scores')).toBe(false)
    // Reading one entry's metadata is not an endpoint at all (only its file is).
    expect(isAllowedForGuest('GET', '/api/scores/2a1c4f6e-0000-4000-8000-000000000000')).toBe(false)
  })
})
