import { describe, expect, it } from 'vitest'
import { progressByCatalogId, sessionReachedPercent } from './scoreProgress.ts'
import type { PracticeSessionRecord } from '../types/session.ts'

const EMPTY_NOTES = { responseCount: 0, averageResponseMs: 0, medianResponseMs: 0, slowestResponseMs: 0, missedNotes: [], wrongNotes: [], confusions: [] }

function session(overrides: Partial<PracticeSessionRecord> = {}): PracticeSessionRecord {
  return {
    id: 'a',
    startedAt: '2026-08-20T10:00:00.000Z',
    endedAt: '2026-08-20T10:10:00.000Z',
    durationMs: 600000,
    completed: false,
    practiceMode: 'scroll',
    handMode: 'both',
    source: { kind: 'score', title: 'Fur Elise', scoreName: 'elise.mxl', catalogId: 'score-1' },
    totalEvents: 200,
    eventsPlayed: 50,
    errorCount: 0,
    correctNoteCount: 120,
    successPercent: 100,
    maxCombo: 10,
    notes: EMPTY_NOTES,
    ...overrides,
  }
}

describe('sessionReachedPercent', () => {
  it('prefers the high-water mark over the cursor position, so working a passage backwards keeps the progress', () => {
    expect(sessionReachedPercent(session({ eventsPlayed: 10, furthestEventIndex: 100 }))).toBe(50)
  })

  it('falls back to eventsPlayed for records written before the high-water mark existed', () => {
    expect(sessionReachedPercent(session({ eventsPlayed: 100 }))).toBe(50)
  })

  it('reserves 100 for a finished session, so a full bar always means the piece was played to its end', () => {
    expect(sessionReachedPercent(session({ completed: true, totalEvents: 0, eventsPlayed: 0 }))).toBe(100)
    expect(sessionReachedPercent(session({ furthestEventIndex: 199, totalEvents: 200 }))).toBe(99)
    // Rounding alone must never reach 100.
    expect(sessionReachedPercent(session({ furthestEventIndex: 1999, totalEvents: 2000 }))).toBe(99)
  })

  it('is 0 rather than NaN or Infinity when the piece has no events', () => {
    expect(sessionReachedPercent(session({ totalEvents: 0, eventsPlayed: 0 }))).toBe(0)
    expect(sessionReachedPercent(session({ eventsPlayed: 0, furthestEventIndex: 0 }))).toBe(0)
  })
})

describe('progressByCatalogId', () => {
  it('keeps the furthest point across sessions, not the latest one', () => {
    const progress = progressByCatalogId([
      session({ id: 'a', furthestEventIndex: 150, startedAt: '2026-08-20T10:00:00.000Z' }),
      session({ id: 'b', furthestEventIndex: 20, startedAt: '2026-08-21T10:00:00.000Z' }),
    ])
    expect(progress.get('score-1')).toMatchObject({ percent: 75, completed: false, sessionCount: 2 })
    expect(progress.get('score-1')?.lastPlayedAt).toBe('2026-08-21T10:00:00.000Z')
  })

  it('marks a piece finished once any session completed it, whatever came after', () => {
    const progress = progressByCatalogId([
      session({ id: 'a', completed: true }),
      session({ id: 'b', furthestEventIndex: 10, startedAt: '2026-08-22T10:00:00.000Z' }),
    ])
    expect(progress.get('score-1')).toMatchObject({ percent: 100, completed: true })
  })

  it('ignores exercises and one-off uploads, which have no catalog row to show', () => {
    const progress = progressByCatalogId([
      session({ id: 'a', source: { kind: 'score', title: 'x', scoreName: 'x.mxl', catalogId: null } }),
      session({
        id: 'b',
        source: { kind: 'exercise', title: 'drill', exercise: { kind: 'hanon', settings: {} as never }, keyName: 'C' },
      }),
    ])
    expect(progress.size).toBe(0)
  })

  it('ignores a score merely opened and closed, the same filter the streak and the stats screen use', () => {
    const progress = progressByCatalogId([
      // No key ever pressed.
      session({ id: 'a', correctNoteCount: 0, errorCount: 0, furthestEventIndex: 100 }),
      // Played, but abandoned under a minute.
      session({ id: 'b', durationMs: 10000, furthestEventIndex: 100 }),
    ])
    expect(progress.size).toBe(0)
  })
})
