import { describe, expect, it } from 'vitest'
import {
  countedSessions,
  createSessionId,
  exerciseSessionTitle,
  isCountedSession,
  mergeSessionLogs,
  sortSessions,
  upsertSession,
} from './sessionLog'
import type { PracticeSessionRecord } from '../types/session'

function session(overrides: Partial<PracticeSessionRecord> = {}): PracticeSessionRecord {
  return {
    id: 'a',
    startedAt: '2026-08-17T10:00:00.000Z',
    endedAt: '2026-08-17T10:10:00.000Z',
    durationMs: 600000,
    completed: false,
    practiceMode: 'scroll',
    handMode: 'both',
    source: { kind: 'score', title: 'Clair de Lune', scoreName: 'clair.mxl', catalogId: null },
    totalEvents: 100,
    eventsPlayed: 40,
    errorCount: 3,
    correctNoteCount: 44,
    successPercent: 92,
    maxCombo: 12,
    notes: {
      responseCount: 0,
      averageResponseMs: 0,
      medianResponseMs: 0,
      slowestResponseMs: 0,
      missedNotes: [],
      wrongNotes: [],
      confusions: [],
    },
    ...overrides,
  }
}

describe('sortSessions', () => {
  it('orders newest first and breaks ties on the id so the order is stable', () => {
    const older = session({ id: 'b', startedAt: '2026-08-16T10:00:00.000Z' })
    const sameMs1 = session({ id: 'x', startedAt: '2026-08-17T10:00:00.000Z' })
    const sameMs2 = session({ id: 'y', startedAt: '2026-08-17T10:00:00.000Z' })

    expect(sortSessions([older, sameMs1, sameMs2]).map((entry) => entry.id)).toEqual(['y', 'x', 'b'])
  })
})

describe('upsertSession', () => {
  it('replaces the snapshot of the same session instead of adding a second row', () => {
    const first = session({ id: 'a', durationMs: 1000 })
    const refreshed = session({ id: 'a', durationMs: 90000 })

    const log = upsertSession(upsertSession([], first), refreshed)

    expect(log).toHaveLength(1)
    expect(log[0].durationMs).toBe(90000)
  })

  it('caps the log at the given limit, dropping the oldest sessions', () => {
    const log = [
      session({ id: 'new', startedAt: '2026-08-17T10:00:00.000Z' }),
      session({ id: 'old', startedAt: '2026-01-01T10:00:00.000Z' }),
    ]

    expect(upsertSession(log, session({ id: 'newest', startedAt: '2026-08-18T10:00:00.000Z' }), 2).map((e) => e.id)).toEqual(
      ['newest', 'new'],
    )
  })
})

describe('mergeSessionLogs', () => {
  it('unions sessions recorded on different devices', () => {
    const phone = [session({ id: 'phone-1' })]
    const desktop = [session({ id: 'desktop-1', startedAt: '2026-08-15T10:00:00.000Z' })]

    expect(mergeSessionLogs(phone, desktop).map((entry) => entry.id)).toEqual(['phone-1', 'desktop-1'])
  })

  it('keeps the completed snapshot when the same session exists twice', () => {
    const heartbeat = session({ id: 'a', durationMs: 30000, completed: false })
    const finished = session({ id: 'a', durationMs: 120000, completed: true })

    expect(mergeSessionLogs([heartbeat], [finished])[0]).toMatchObject({ completed: true, durationMs: 120000 })
    // Order of the two sides must not change the outcome, or a sync would flip
    // the record back and forth depending on who called it.
    expect(mergeSessionLogs([finished], [heartbeat])[0]).toMatchObject({ completed: true, durationMs: 120000 })
  })

  it('keeps the longer snapshot of an unfinished session', () => {
    const early = session({ id: 'a', durationMs: 30000 })
    const later = session({ id: 'a', durationMs: 300000 })

    expect(mergeSessionLogs([later], [early])[0].durationMs).toBe(300000)
  })

  it('is idempotent, so re-syncing the same log changes nothing', () => {
    const log = [session({ id: 'a' }), session({ id: 'b', startedAt: '2026-08-16T10:00:00.000Z' })]

    expect(mergeSessionLogs(log, log)).toEqual(log)
  })
})

describe('exerciseSessionTitle', () => {
  it('names a Hanon drill by number, key and hands', () => {
    expect(
      exerciseSessionTitle(
        { kind: 'hanon', settings: { exerciseNumber: 3, handMode: 'both', key: 'C', octaveShift: 0, length: 'ascending' } },
        'B-flat major',
      ),
    ).toBe('Hanon #3 - B-flat major - both hands, ascending')
  })

  it('names a generated drill by content, key, hand and difficulty', () => {
    expect(
      exerciseSessionTitle(
        {
          kind: 'generated',
          settings: {
            handMode: 'right',
            accidentalMode: 'none',
            difficulty: 'medium',
            contentMode: 'triads',
            tonality: 'major',
            // 'random' is what the setup screen stores; the resolved key wins.
            key: 'random',
            measureCount: 8,
            rightOctaveLow: 4,
            rightOctaveHigh: 5,
            leftOctaveLow: 2,
            leftOctaveHigh: 3,
          },
        },
        'G major',
      ),
    ).toBe('Triads - G major - right hand (medium)')
  })
})

describe('isCountedSession', () => {
  it('drops a screen that was opened without a single key pressed', () => {
    expect(
      isCountedSession(session({ correctNoteCount: 0, errorCount: 0, durationMs: 600000, completed: false })),
    ).toBe(false)
  })

  it('drops an unfinished visit shorter than a minute', () => {
    expect(isCountedSession(session({ correctNoteCount: 4, durationMs: 20000, completed: false }))).toBe(false)
  })

  it('keeps a finished session however short', () => {
    // A generated 8-measure drill played cleanly in 45 seconds is real practice.
    expect(isCountedSession(session({ correctNoteCount: 32, durationMs: 45000, completed: true }))).toBe(true)
  })

  it('keeps an unfinished session past the minute mark', () => {
    expect(isCountedSession(session({ correctNoteCount: 12, durationMs: 90000, completed: false }))).toBe(true)
  })

  it('counts wrong notes as having played something', () => {
    expect(
      isCountedSession(session({ correctNoteCount: 0, errorCount: 7, durationMs: 120000, completed: false })),
    ).toBe(true)
  })

  it('filters a log without touching its order', () => {
    const kept = session({ id: 'kept', correctNoteCount: 5, durationMs: 300000 })
    const dropped = session({ id: 'dropped', correctNoteCount: 0, errorCount: 0, completed: false })

    expect(countedSessions([kept, dropped]).map((entry) => entry.id)).toEqual(['kept'])
  })
})

describe('createSessionId', () => {
  it('produces distinct 32-character hex ids', () => {
    const ids = Array.from({ length: 200 }, createSessionId)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('works without crypto.randomUUID, which production does not have', () => {
    // Production is plain HTTP, so [SecureContext] APIs are missing there while
    // present on localhost -- exactly how this shipped broken once.
    const original = globalThis.crypto
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: original.getRandomValues.bind(original) },
        configurable: true,
      })
      expect(createSessionId()).toMatch(/^[0-9a-f]{32}$/)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
    }
  })

  it('falls back when the whole Crypto API is unavailable', () => {
    const original = globalThis.crypto
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
      expect(createSessionId()).toMatch(/^[0-9a-f]{32}$/)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true })
    }
  })
})
