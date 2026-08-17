import { afterEach, describe, expect, it } from 'vitest'
import { configuredPassword, createLoginThrottle, isValidToken, tokenForPassword } from './auth.ts'

const originalPassword = process.env.PIANO_TRAINER_PASSWORD

afterEach(() => {
  if (originalPassword === undefined) {
    delete process.env.PIANO_TRAINER_PASSWORD
  } else {
    process.env.PIANO_TRAINER_PASSWORD = originalPassword
  }
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
  it('blocks once the failures pile up inside the window', () => {
    const throttle = createLoginThrottle(3, 60000)

    expect(throttle.isBlocked(1000)).toBe(false)
    throttle.registerFailure(1000)
    throttle.registerFailure(1100)
    expect(throttle.isBlocked(1200)).toBe(false)
    throttle.registerFailure(1200)
    expect(throttle.isBlocked(1300)).toBe(true)
  })

  it('forgets failures older than the window', () => {
    const throttle = createLoginThrottle(2, 60000)
    throttle.registerFailure(1000)
    throttle.registerFailure(2000)

    expect(throttle.isBlocked(3000)).toBe(true)
    expect(throttle.isBlocked(70000)).toBe(false)
  })

  it('clears on a successful login, so one bad guess does not haunt the session', () => {
    const throttle = createLoginThrottle(2, 60000)
    throttle.registerFailure(1000)
    throttle.registerFailure(1100)
    throttle.reset()

    expect(throttle.isBlocked(1200)).toBe(false)
  })
})
