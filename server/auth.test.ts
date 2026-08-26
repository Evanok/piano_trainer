import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configuredGuestPassword,
  configuredPassword,
  createLoginThrottle,
  guestToken,
  isValidToken,
  resolveRole,
  tokenForPassword,
} from './auth.ts'

const originalPassword = process.env.PIANO_TRAINER_PASSWORD
const originalGuestPassword = process.env.PIANO_TRAINER_GUEST_PASSWORD

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

afterEach(() => {
  restore('PIANO_TRAINER_PASSWORD', originalPassword)
  restore('PIANO_TRAINER_GUEST_PASSWORD', originalGuestPassword)
})

describe('configuredPassword', () => {
  it('is null when unset, so an upgrading deployment stays open instead of locking its owner out', () => {
    delete process.env.PIANO_TRAINER_PASSWORD
    expect(configuredPassword()).toBeNull()
  })

  it('treats an empty value as unset rather than as an empty password', () => {
    process.env.PIANO_TRAINER_PASSWORD = ''
    expect(configuredPassword()).toBeNull()
  })

  it('reads the configured password', () => {
    process.env.PIANO_TRAINER_PASSWORD = 'hunter2'
    expect(configuredPassword()).toBe('hunter2')
  })
})

describe('configuredGuestPassword', () => {
  it('is null when unset, which simply means no guest link exists', () => {
    delete process.env.PIANO_TRAINER_GUEST_PASSWORD
    expect(configuredGuestPassword()).toBeNull()
  })

  it('reads the configured guest password', () => {
    process.env.PIANO_TRAINER_GUEST_PASSWORD = 'come-in'
    expect(configuredGuestPassword()).toBe('come-in')
  })

  it('ignores a guest password identical to the owner one, which would hand out full access', () => {
    process.env.PIANO_TRAINER_PASSWORD = 'hunter2'
    process.env.PIANO_TRAINER_GUEST_PASSWORD = 'hunter2'
    expect(configuredGuestPassword()).toBeNull()
  })
})

describe('tokenForPassword', () => {
  it('is stable, so a server restart does not log every device out', () => {
    expect(tokenForPassword('hunter2')).toBe(tokenForPassword('hunter2'))
  })

  it('does not contain the password itself', () => {
    expect(tokenForPassword('hunter2')).not.toContain('hunter2')
    expect(tokenForPassword('hunter2')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs per password', () => {
    expect(tokenForPassword('hunter2')).not.toBe(tokenForPassword('hunter3'))
  })

  it('differs per role, so the same password can never yield an owner token on the guest path', () => {
    expect(tokenForPassword('hunter2', 'guest')).not.toBe(tokenForPassword('hunter2', 'owner'))
  })

  it('leaves the owner derivation untouched, so tokens stored before guest links keep working', () => {
    expect(tokenForPassword('hunter2')).toBe(
      createHash('sha256').update('piano-trainer:hunter2').digest('hex'),
    )
  })
})

describe('resolveRole', () => {
  it('calls everyone the owner when no password is configured', () => {
    delete process.env.PIANO_TRAINER_PASSWORD
    expect(resolveRole(undefined)).toBe('owner')
  })

  it('recognises the owner and the guest by their own tokens', () => {
    process.env.PIANO_TRAINER_PASSWORD = 'hunter2'
    process.env.PIANO_TRAINER_GUEST_PASSWORD = 'come-in'
    expect(resolveRole(tokenForPassword('hunter2', 'owner'))).toBe('owner')
    expect(resolveRole(tokenForPassword('come-in', 'guest'))).toBe('guest')
  })

  it('rejects an unknown token, and a guest token when no guest password is set', () => {
    process.env.PIANO_TRAINER_PASSWORD = 'hunter2'
    delete process.env.PIANO_TRAINER_GUEST_PASSWORD
    expect(resolveRole('nonsense')).toBeNull()
    expect(resolveRole(tokenForPassword('come-in', 'guest'))).toBeNull()
  })

  it('never promotes a guest token to owner, even for the owner password', () => {
    process.env.PIANO_TRAINER_PASSWORD = 'hunter2'
    process.env.PIANO_TRAINER_GUEST_PASSWORD = 'come-in'
    expect(resolveRole(tokenForPassword('hunter2', 'guest'))).toBeNull()
  })
})

describe('guestToken', () => {
  it('is null without a guest password and matches the derivation with one', () => {
    process.env.PIANO_TRAINER_PASSWORD = 'hunter2'
    delete process.env.PIANO_TRAINER_GUEST_PASSWORD
    expect(guestToken()).toBeNull()

    process.env.PIANO_TRAINER_GUEST_PASSWORD = 'come-in'
    expect(guestToken()).toBe(tokenForPassword('come-in', 'guest'))
  })
})

describe('isValidToken', () => {
  it('accepts the token derived from the password', () => {
    expect(isValidToken(tokenForPassword('hunter2'), 'hunter2')).toBe(true)
  })

  it('rejects a token for another password, a missing one, and a truncated one', () => {
    expect(isValidToken(tokenForPassword('hunter3'), 'hunter2')).toBe(false)
    expect(isValidToken(undefined, 'hunter2')).toBe(false)
    expect(isValidToken('', 'hunter2')).toBe(false)
    // A length mismatch must not throw out of timingSafeEqual.
    expect(isValidToken(tokenForPassword('hunter2').slice(0, 10), 'hunter2')).toBe(false)
  })
})

describe('createLoginThrottle', () => {
  const A = '203.0.113.7'
  const B = '198.51.100.9'

  it('blocks once one client piles up failures inside the window', () => {
    const throttle = createLoginThrottle(3, 60000)

    expect(throttle.isBlocked(A, 1000)).toBe(false)
    throttle.registerFailure(A, 1000)
    throttle.registerFailure(A, 1100)
    expect(throttle.isBlocked(A, 1200)).toBe(false)
    throttle.registerFailure(A, 1200)
    expect(throttle.isBlocked(A, 1300)).toBe(true)
  })

  it('never lets one client lock another out, which is the whole point of counting per address', () => {
    const throttle = createLoginThrottle(2, 60000)
    throttle.registerFailure(A, 1000)
    throttle.registerFailure(A, 1100)

    expect(throttle.isBlocked(A, 1200)).toBe(true)
    expect(throttle.isBlocked(B, 1200)).toBe(false)
  })

  it('forgets failures older than the window', () => {
    const throttle = createLoginThrottle(2, 60000)
    throttle.registerFailure(A, 1000)
    throttle.registerFailure(A, 2000)

    expect(throttle.isBlocked(A, 3000)).toBe(true)
    expect(throttle.isBlocked(A, 70000)).toBe(false)
  })

  it('clears on a successful login, so one bad guess does not haunt that client', () => {
    const throttle = createLoginThrottle(2, 60000)
    throttle.registerFailure(A, 1000)
    throttle.registerFailure(A, 1100)
    throttle.reset(A)

    expect(throttle.isBlocked(A, 1200)).toBe(false)
  })

  it('drops clients whose failures expired, so the map does not grow with every address seen', () => {
    const throttle = createLoginThrottle(5, 60000)
    for (let i = 0; i < 50; i += 1) {
      throttle.registerFailure(`10.0.0.${i}`, 1000)
    }
    expect(throttle.size()).toBe(50)

    // One more, a full window later: everything older is expired by then.
    throttle.registerFailure('10.0.1.1', 100000)
    expect(throttle.size()).toBe(1)
  })

  it('stays bounded even when every tracked failure is still live', () => {
    const throttle = createLoginThrottle(5, 60000, 10)
    for (let i = 0; i < 40; i += 1) {
      throttle.registerFailure(`10.0.0.${i}`, 1000 + i)
    }

    expect(throttle.size()).toBe(10)
    // The most recent client is kept; the oldest were evicted first.
    expect(throttle.isBlocked('10.0.0.39', 1100)).toBe(false)
  })
})
