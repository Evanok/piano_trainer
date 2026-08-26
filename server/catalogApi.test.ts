import { describe, expect, it } from 'vitest'
import { clientAddress, isAllowedForGuest } from './catalogApi.ts'

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

/**
 * The address the login throttle counts against. Security-relevant in both
 * directions: too trusting and anyone bypasses the limit with a header, too
 * strict and every visitor behind the reverse proxy shares one counter.
 */
describe('clientAddress', () => {
  const request = (remoteAddress: string, forwarded?: string) =>
    ({ socket: { remoteAddress }, headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded } }) as never

  it('uses the socket address for a direct connection', () => {
    expect(clientAddress(request('203.0.113.7'))).toBe('203.0.113.7')
  })

  it('ignores X-Forwarded-For from a direct connection, where it is pure client input', () => {
    expect(clientAddress(request('203.0.113.7', '10.0.0.1'))).toBe('203.0.113.7')
  })

  it('reads X-Forwarded-For when the reverse proxy on this host is the caller', () => {
    expect(clientAddress(request('127.0.0.1', '203.0.113.7'))).toBe('203.0.113.7')
    expect(clientAddress(request('::ffff:127.0.0.1', '203.0.113.7'))).toBe('203.0.113.7')
  })

  it('takes the entry the proxy appended, not the one the client made up', () => {
    // The client sent "1.2.3.4"; nginx appended what it really saw.
    expect(clientAddress(request('127.0.0.1', '1.2.3.4, 203.0.113.7'))).toBe('203.0.113.7')
  })

  it('falls back to the socket address when the proxy sent no header', () => {
    expect(clientAddress(request('127.0.0.1'))).toBe('127.0.0.1')
    expect(clientAddress(request('127.0.0.1', '  '))).toBe('127.0.0.1')
  })
})
