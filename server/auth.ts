import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Single shared password for the whole API, since this is a one-person
 * deployment with no account system.
 *
 * The gate is enforced HERE, on the API, not by the login screen: a screen in
 * the front-end stops nobody, because `curl http://host:5173/api/scores` never
 * loads it. Reads are gated too, not just writes -- the practice history is the
 * thing most worth keeping private, and it is only readable.
 *
 * Known limitation, deliberate: production is plain HTTP (no domain, no reverse
 * proxy -- see README), so the password and the token travel in clear. This
 * stops passers-by, bots and port scanners; it does not stop someone
 * sniffing the network. That would need TLS or a VPN, both out of scope here.
 */

/** Header the front-end sends its token in. */
export const AUTH_HEADER = 'x-piano-trainer-token'

/** Unset means "no gate at all" -- development, and any existing deployment
 *  that upgrades without setting it (it must not lock the owner out). */
export function configuredPassword(): string | null {
  const raw = process.env.PIANO_TRAINER_PASSWORD
  return raw && raw.length > 0 ? raw : null
}

/**
 * Derived from the password rather than randomly generated and remembered, so
 * it survives a server restart: a deploy would otherwise log every device out.
 * It is password-equivalent (whoever holds it is in), it just avoids keeping the
 * plaintext in every device's localStorage.
 */
export function tokenForPassword(password: string): string {
  return createHash('sha256').update(`piano-trainer:${password}`).digest('hex')
}

export function isValidToken(token: string | undefined, password: string): boolean {
  if (!token) {
    return false
  }
  const expected = Buffer.from(tokenForPassword(password), 'utf8')
  const actual = Buffer.from(token, 'utf8')
  // timingSafeEqual throws on a length mismatch, so that is checked first --
  // and the length of a hex digest is public anyway.
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export interface LoginThrottle {
  isBlocked(now: number): boolean
  registerFailure(now: number): void
  reset(): void
}

/**
 * Brute-force brake on the one endpoint that has to stay open. Counts recent
 * failures globally rather than per IP: this is a single-user app, so "someone
 * is guessing" is the only meaning a burst of failures can have, and a per-IP
 * map would just be a slower way to be wrong behind a NAT.
 *
 * Takes `now` from the caller so the window is testable without waiting.
 */
export function createLoginThrottle(maxFailures = 10, windowMs = 60000): LoginThrottle {
  let failures: number[] = []
  return {
    isBlocked(now) {
      failures = failures.filter((at) => now - at < windowMs)
      return failures.length >= maxFailures
    },
    registerFailure(now) {
      failures.push(now)
    },
    reset() {
      failures = []
    },
  }
}
