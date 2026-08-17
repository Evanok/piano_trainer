/**
 * Client side of the API password gate (server/auth.ts). The token is stored per
 * device so logging in is a once-per-browser thing, not once per session.
 */

const STORAGE_KEY = 'piano-trainer:token'
const AUTH_HEADER = 'x-piano-trainer-token'

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

export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
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
  return { required: body.required === true, authenticated: body.authenticated === true }
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
  const body = (await response.json()) as { token?: unknown }
  if (typeof body.token !== 'string') {
    throw new Error('The server did not return a token.')
  }
  setToken(body.token)
}
