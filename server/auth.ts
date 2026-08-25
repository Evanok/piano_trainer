import { createHash, timingSafeEqual } from 'node:crypto'
import type { ApiRole } from '../src/types/auth.ts'

/**
 * Single shared password for the whole API, since this is a one-person
 * deployment with no account system.
 *
 * The gate is enforced HERE, on the API, not by the login screen: a screen in
 * the front-end stops nobody, because `curl http://host:5173/api/scores` never
 * loads it. Reads are gated too, not just writes -- the practice history is the
 * thing most worth keeping private, and it is only readable.
 *
 * A second, optional password (PIANO_TRAINER_GUEST_PASSWORD) mints a *guest*
 * token instead: same reads, no writes at all. It exists so the deployment can
 * be shown to someone without letting them upload to the catalog, delete an
 * entry, or push their own practice into the owner's history. Which endpoints a
 * guest may call is decided in catalogApi.ts; this module only says who a token
 * belongs to.
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
 * The read-only password, optional: unset simply means no guest link exists.
 *
 * A guest password identical to the owner's is treated as unset rather than
 * honoured, because login checks the owner's first: whoever was handed the
 * "read only" password would silently get a full-access token back.
 */
export function configuredGuestPassword(): string | null {
  const raw = process.env.PIANO_TRAINER_GUEST_PASSWORD
  if (!raw || raw.length === 0) {
    return null
  }
  return raw === configuredPassword() ? null : raw
}

/**
 * Derived from the password rather than randomly generated and remembered, so
 * it survives a server restart: a deploy would otherwise log every device out.
 * It is password-equivalent (whoever holds it is in), it just avoids keeping the
 * plaintext in every device's localStorage.
 *
 * The role goes into the hashed string, so a guest token can never collide with
 * an owner one even if both passwords were somehow the same. The owner's input
 * is left exactly as it always was, so tokens already stored on the owner's
 * devices keep working across this upgrade.
 */
export function tokenForPassword(password: string, role: ApiRole = 'owner'): string {
  const material = role === 'guest' ? `piano-trainer:guest:${password}` : `piano-trainer:${password}`
  return createHash('sha256').update(material).digest('hex')
}

export function isValidToken(token: string | undefined, password: string, role: ApiRole = 'owner'): boolean {
  if (!token) {
    return false
  }
  const expected = Buffer.from(tokenForPassword(password, role), 'utf8')
  const actual = Buffer.from(token, 'utf8')
  // timingSafeEqual throws on a length mismatch, so that is checked first --
  // and the length of a hex digest is public anyway.
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Who this request is, or null for "not authenticated at all".
 *
 * With no password configured everyone is the owner, which is what keeps a
 * gate-less deployment working exactly as before. The owner is checked first,
 * so the owner's own password never lands on the guest path.
 */
export function resolveRole(token: string | undefined): ApiRole | null {
  const password = configuredPassword()
  if (password === null) {
    return 'owner'
  }
  if (isValidToken(token, password, 'owner')) {
    return 'owner'
  }
  const guestPassword = configuredGuestPassword()
  if (guestPassword !== null && isValidToken(token, guestPassword, 'guest')) {
    return 'guest'
  }
  return null
}

/** The secret inside a guest link, or null when no guest password is set. Only
 *  ever handed to the owner (see /api/auth), since it *is* the guest link. */
export function guestToken(): string | null {
  const guestPassword = configuredGuestPassword()
  return guestPassword === null ? null : tokenForPassword(guestPassword, 'guest')
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
