/**
 * Device-local screen preferences: the catalog's filters and every setting of
 * the exercise setup screen, so reopening the app (or the screen) picks up where
 * the player left off instead of resetting to the defaults.
 *
 * localStorage rather than a cookie: nothing here is ever wanted by the server,
 * and a cookie would ride along on every API request for nothing. Like the
 * session log (sessionStore.ts) it is per device, which is the right scope for
 * "how I like this screen set up" -- the phone and the piano want different
 * drills.
 */
const STORAGE_PREFIX = 'piano-trainer:prefs:'

export type PreferenceKey =
  | 'catalog-browse'
  | 'setup-tab'
  | 'exercise-training'
  | 'exercise-hanon'
  | 'exercise-options'
  | 'reading'
  | 'sequence'
  | 'chords'

/**
 * Lays a stored value over its defaults, keeping only what still has the shape
 * the defaults expect. A preference written by an older build may lack a field
 * added since, or hold one whose type changed; either way the default stands in
 * for that one field rather than the whole object being thrown away. Values are
 * checked by type, not against their enum: an enum member that no longer exists
 * still reaches the screen, which then shows its select on the first option.
 */
export function mergeWithDefaults<T>(defaults: T, stored: unknown): T {
  if (stored === undefined || stored === null) {
    return defaults
  }
  if (Array.isArray(defaults)) {
    return (Array.isArray(stored) ? stored : defaults) as T
  }
  if (typeof defaults !== 'object' || defaults === null) {
    return (typeof stored === typeof defaults ? stored : defaults) as T
  }
  if (typeof stored !== 'object' || Array.isArray(stored)) {
    return defaults
  }
  const merged = { ...defaults } as Record<string, unknown>
  const source = stored as Record<string, unknown>
  for (const [key, fallback] of Object.entries(defaults as Record<string, unknown>)) {
    if (key in source) {
      merged[key] = mergeWithDefaults(fallback, source[key])
    }
  }
  return merged as T
}

export function loadPreference<T>(key: PreferenceKey, defaults: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw === null ? defaults : mergeWithDefaults(defaults, JSON.parse(raw))
  } catch {
    // Storage unavailable or a corrupt entry: the defaults are always a valid answer.
    return defaults
  }
}

export function savePreference<T>(key: PreferenceKey, value: T): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private browsing, quota) -- the setting just won't persist.
  }
}
