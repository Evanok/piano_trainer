import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSessions, sanitizeSessions, syncSessions } from './statsStore.ts'
import type { PracticeSessionRecord } from '../src/types/session.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'piano-trainer-stats-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function session(overrides: Partial<PracticeSessionRecord> = {}): PracticeSessionRecord {
  return {
    id: 'session-1',
    startedAt: '2026-08-17T10:00:00.000Z',
    endedAt: '2026-08-17T10:10:00.000Z',
    durationMs: 600000,
    completed: true,
    practiceMode: 'scroll',
    handMode: 'both',
    source: { kind: 'score', title: 'Clair de Lune', scoreName: 'clair.mxl', catalogId: null },
    totalEvents: 100,
    eventsPlayed: 100,
    errorCount: 1,
    correctNoteCount: 101,
    successPercent: 99,
    maxCombo: 40,
    notes: {
      responseCount: 100,
      averageResponseMs: 800,
      medianResponseMs: 700,
      slowestResponseMs: 4000,
      missedNotes: [],
      wrongNotes: [],
      confusions: [],
    },
    ...overrides,
  }
}

describe('readSessions', () => {
  it('is empty before anything was ever synced', () => {
    expect(readSessions(dataDir)).toEqual([])
  })

  it('throws on a corrupt file rather than reading it as an empty history', () => {
    // Silently starting from empty would let the next sync overwrite a real
    // history with whatever one device happens to hold.
    writeFileSync(path.join(dataDir, 'stats.json'), '{ not json', 'utf8')

    expect(() => readSessions(dataDir)).toThrow()
  })
})

describe('syncSessions', () => {
  it('stores what a device posts and hands it back', () => {
    const merged = syncSessions(dataDir, [session()])

    expect(merged).toHaveLength(1)
    expect(readSessions(dataDir)).toEqual(merged)
  })

  it('unions what two devices recorded', () => {
    syncSessions(dataDir, [session({ id: 'phone' })])
    const merged = syncSessions(dataDir, [session({ id: 'desktop', startedAt: '2026-08-16T09:00:00.000Z' })])

    expect(merged.map((entry) => entry.id)).toEqual(['phone', 'desktop'])
  })

  it('is idempotent, so a retried sync is free', () => {
    const sessions = [session({ id: 'a' }), session({ id: 'b', startedAt: '2026-08-16T09:00:00.000Z' })]

    expect(syncSessions(dataDir, sessions)).toEqual(syncSessions(dataDir, sessions))
  })

  it('upgrades a session the server only knew as unfinished', () => {
    syncSessions(dataDir, [session({ id: 'a', completed: false, durationMs: 30000 })])
    const merged = syncSessions(dataDir, [session({ id: 'a', completed: true, durationMs: 600000 })])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ completed: true, durationMs: 600000 })
  })

  it('writes valid JSON that reads back unchanged', () => {
    syncSessions(dataDir, [session()])

    expect(JSON.parse(readFileSync(path.join(dataDir, 'stats.json'), 'utf8'))).toEqual([session()])
  })
})

describe('sanitizeSessions', () => {
  it('drops entries that are not session records', () => {
    const kept = sanitizeSessions([session(), null, 'nope', {}, { id: 'x' }, { ...session(), notes: undefined }])

    expect(kept).toHaveLength(1)
    expect(kept[0].id).toBe('session-1')
  })

  it('rejects a record whose start time is not a date', () => {
    expect(sanitizeSessions([session({ startedAt: 'someday' })])).toEqual([])
  })

  it('ignores a payload that is not an array at all', () => {
    expect(sanitizeSessions({ sessions: [] })).toEqual([])
  })
})
