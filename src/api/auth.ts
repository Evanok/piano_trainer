import type { ApiRole } from '../types/auth'

/**
 * Client side of the API password gate (server/auth.ts). The token is stored per
 * device so logging in is a once-per-browser thing, not once per session.
 *
 * A device can hold either kind of token. The role is stored alongside it so the
 * UI can hide what a guest is not allowed to do, but it is never the thing that
 * enforces anything -- the server refuses the call regardless of what the screen
 * shows.
 */

const STORAGE_KEY = 'piano-trainer:token'
const ROLE_STORAGE_KEY = 'piano-trainer:role'
const AUTH_HEADER = 'x-piano-trainer-token'
/** Query parameter carrying a guest token, i.e. the share link's whole secret. */
const GUEST_LINK_PARAM = 'guest'

/** Thrown by any API call the server answered with 401, so the UI can send the
 *  player back to the login screen instead of showing a raw error. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required.')
    this.name = 'AuthRequiredError'
  }
}

type AuthRequiredListener = () => void

const authRequiredListeners = new Set<AuthRequiredListener>()

/** Lets App show the login screen the moment any request comes back 401 --
 *  otherwise a token the server stopped accepting (the password changed) would
 *  just make every screen show its own error until the next reload. */
export function subscribeAuthRequired(listener: AuthRequiredListener): () => void {
  authRequiredListeners.add(listener)
  return () => {
    authRequiredListeners.delete(listener)
  }
}

/** Called by the API modules on a 401, before they throw AuthRequiredError. */
export function notifyAuthRequired(): void {
  clearToken()
  for (const listener of authRequiredListeners) {
    listener()
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function setToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Storage unavailable (private browsing): the session still works, the
    // password will just be asked again next time.
  }
}

/** Defaults to 'owner', which is what an ungated deployment (and every device
 *  from before guest links existed) should behave as. */
export function getRole(): ApiRole {
  try {
    return localStorage.getItem(ROLE_STORAGE_KEY) === 'guest' ? 'guest' : 'owner'
  } catch {
    return 'owner'
  }
}

/** Read-only session: the screens use it to hide what the server would refuse. */
export function isGuest(): boolean {
  return getRole() === 'guest'
}

function setRole(role: ApiRole): void {
  try {
    localStorage.setItem(ROLE_STORAGE_KEY, role)
  } catch {
    // Same degradation as the token above.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    // Cleared together: a device with no token has no role either, and leaving
    // a stale 'guest' behind would keep the owner's own screens read-only after
    // they log back in.
    localStorage.removeItem(ROLE_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * Turns `http://host:5173/?guest=<token>` into a logged-in read-only session.
 *
 * The link carries the credential itself rather than a mere "guest mode" flag:
 * a flag would stop nothing (the API is what enforces this, and it answers
 * `curl` too), and the recipient has no password to type. The parameter is
 * dropped from the address bar right after, so a reload or a shared screenshot
 * of the URL does not keep repeating the secret.
 *
 * Call it before the first request of the session. Calling it again is a no-op,
 * which is what makes it safe under StrictMode's double-invoked effects.
 */
export function adoptGuestLinkToken(): void {
  const url = new URL(window.location.href)
  const token = url.searchParams.get(GUEST_LINK_PARAM)
  if (!token) {
    return
  }
  setToken(token)
  setRole('guest')
  url.searchParams.delete(GUEST_LINK_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

/** Builds the link to hand out, from the token the server gave the owner. */
export function guestLinkFor(token: string): string {
  return `${window.location.origin}${window.location.pathname}?${GUEST_LINK_PARAM}=${encodeURIComponent(token)}`
}

/** Merged into every API request's headers; empty when no token is held. */
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { [AUTH_HEADER]: token } : {}
}

export interface AuthStatus {
  /** False when the server has no password configured -- no login screen then. */
  required: boolean
  /** True when the token this device holds is accepted (or none is needed). */
  authenticated: boolean
  /** What this device's token is, or null when it is not accepted at all. */
  role: ApiRole | null
  /** The guest link's token, sent to the owner only, null when no guest
   *  password is configured on the server. */
  guestToken: string | null
}

/**
 * Asks the server whether a password is needed and whether the stored token is
 * still good. Rejects when the server can't be reached at all, which the caller
 * treats as "carry on" rather than as a locked door -- practice must not depend
 * on the API being up.
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth', { headers: authHeaders() })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  const body = (await response.json()) as Partial<AuthStatus>
  const role = body.role === 'guest' ? 'guest' : body.role === 'owner' ? 'owner' : null
  // The server is the authority on the role, so this also repairs a device
  // whose stored role drifted (a revoked guest link, or the owner logging back
  // in on a phone they had once opened their own guest link on).
  if (role !== null) {
    setRole(role)
  }
  return {
    required: body.required === true,
    authenticated: body.authenticated === true,
    role,
    guestToken: typeof body.guestToken === 'string' ? body.guestToken : null,
  }
}

/** Exchanges the password for the token and stores it. Throws on a wrong password. */
export async function login(password: string): Promise<void> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body: unknown = await response.json()
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        message = (body as { error: string }).error
      }
    } catch {
      // Keep the status line.
    }
    throw new Error(message)
  }
  const body = (await response.json()) as { token?: unknown; role?: unknown }
  if (typeof body.token !== 'string') {
    throw new Error('The server did not return a token.')
  }
  setToken(body.token)
  setRole(body.role === 'guest' ? 'guest' : 'owner')
}
