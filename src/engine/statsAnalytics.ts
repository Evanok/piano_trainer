import type { PracticeSessionRecord } from '../types/session'

/**
 * Every aggregate the stats screen shows, computed from the session log alone.
 * Pure and DOM-free (same reason WaitEngine is): the numbers are the part worth
 * unit-testing, and none of them need to know where the log came from.
 */

const DAY_MS = 86400000

/** Local calendar day -- a practice day is the player's own day, not UTC's. */
export function localDayString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Date.UTC of a day string is timezone- and DST-independent, so subtracting two
 * of these always yields an exact whole-day count -- unlike subtracting real
 * (local, DST-affected) Date instants.
 */
function dayNumber(dayString: string): number {
  const [year, month, day] = dayString.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

function addDays(date: Date, delta: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + delta)
  return result
}

function sessionDay(session: PracticeSessionRecord): string {
  return localDayString(new Date(session.startedAt))
}

/**
 * How long a break may be before the next piece counts as a new sitting rather
 * than a continuation of the same one. Sessions are per visit to the practice
 * screen (one per piece worked), which is the wrong unit for "how long do I
 * practice" -- one 45-minute sitting spread over three scores is three sessions.
 * 15 minutes is generous enough to cover getting a drink or re-reading a page,
 * short enough that the evening's practice isn't glued to the morning's.
 */
export const DEFAULT_BLOCK_GAP_MS = 15 * 60000

/** One sitting at the piano: the sessions of every piece worked back to back. */
export interface PracticeBlock {
  /** The first session's id -- stable for as long as that session exists. */
  id: string
  startedAt: string
  endedAt: string
  /**
   * Practice time, i.e. the sum of its sessions' durations, NOT the wall-clock
   * span from first start to last end: the gaps between pieces would otherwise
   * count as practice and disagree with every other minute count on the screen.
   */
  durationMs: number
  /** Newest first, same order as the log itself. */
  sessions: PracticeSessionRecord[]
  completedCount: number
  errorCount: number
  successPercent: number
  maxCombo: number
}

/**
 * Groups the log into sittings. Input and output are both newest first; two
 * sessions belong together when the later one started within `gapMs` of the
 * earlier one ending.
 */
export function groupPracticeBlocks(
  sessions: PracticeSessionRecord[],
  gapMs: number = DEFAULT_BLOCK_GAP_MS,
): PracticeBlock[] {
  const ordered = [...sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
  const groups: PracticeSessionRecord[][] = []
  for (const session of ordered) {
    const current = groups[groups.length - 1]
    // `current` runs newest first, so its last entry is the oldest session so
    // far and the one this session would sit just before in time.
    const olderNeighbour = current?.[current.length - 1]
    if (olderNeighbour && Date.parse(olderNeighbour.startedAt) - Date.parse(session.endedAt) <= gapMs) {
      current.push(session)
    } else {
      groups.push([session])
    }
  }

  return groups.map((group) => {
    const oldest = group[group.length - 1]
    const newest = group[0]
    return {
      id: oldest.id,
      startedAt: oldest.startedAt,
      endedAt: newest.endedAt,
      durationMs: group.reduce((total, session) => total + session.durationMs, 0),
      sessions: group,
      completedCount: group.filter((session) => session.completed).length,
      errorCount: group.reduce((total, session) => total + session.errorCount, 0),
      successPercent: Math.round(group.reduce((total, session) => total + session.successPercent, 0) / group.length),
      maxCombo: group.reduce((best, session) => Math.max(best, session.maxCombo), 0),
    }
  })
}

export interface StreakStats {
  currentStreak: number
  longestStreak: number
  totalDaysPracticed: number
}

/**
 * Streaks are derived from the session log rather than kept in their own store:
 * a session is already recorded the moment practice starts, so the log knows
 * every practiced day, and one source of truth means the streak syncs across
 * devices for free.
 *
 * The current streak is alive if the last practiced day is today or yesterday
 * -- it survives until a full day is missed, the Duolingo-style convention.
 */
export function computeStreak(sessions: PracticeSessionRecord[], now: Date = new Date()): StreakStats {
  const days = Array.from(new Set(sessions.map(sessionDay))).sort()
  if (days.length === 0) {
    return { currentStreak: 0, longestStreak: 0, totalDaysPracticed: 0 }
  }

  let longestStreak = 1
  let run = 1
  for (let i = 1; i < days.length; i += 1) {
    run = dayNumber(days[i]) - dayNumber(days[i - 1]) === 1 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
  }

  const lastDay = days[days.length - 1]
  const isAlive = lastDay === localDayString(now) || lastDay === localDayString(addDays(now, -1))
  let currentStreak = 0
  if (isAlive) {
    currentStreak = 1
    for (let i = days.length - 1; i > 0; i -= 1) {
      if (dayNumber(days[i]) - dayNumber(days[i - 1]) !== 1) {
        break
      }
      currentStreak += 1
    }
  }

  return { currentStreak, longestStreak, totalDaysPracticed: days.length }
}

/**
 * The headline numbers are per *sitting* (block), not per session: a session is
 * one piece worked, so averaging those answers "how long do I spend on a piece"
 * rather than "how long do I practice". Both counts are reported, since the
 * stats screen shows sittings with their pieces nested underneath.
 */
export interface WindowSummary {
  /** Sittings at the piano (see groupPracticeBlocks). */
  blockCount: number
  /** Sittings per week over the window (see WEEKLY_RATE_MINIMUM_DAYS). */
  blocksPerWeek: number
  averageBlockMs: number
  longestBlockMs: number
  /** Pieces worked -- one session per visit to the practice screen. */
  sessionCount: number
  completedCount: number
  totalMs: number
  minutesPerWeek: number
  averageSuccessPercent: number
  averageResponseMs: number
  daysPracticed: number
  totalErrors: number
  totalEvents: number
}

const EMPTY_SUMMARY: WindowSummary = {
  blockCount: 0,
  blocksPerWeek: 0,
  averageBlockMs: 0,
  longestBlockMs: 0,
  sessionCount: 0,
  completedCount: 0,
  totalMs: 0,
  minutesPerWeek: 0,
  averageSuccessPercent: 0,
  averageResponseMs: 0,
  daysPracticed: 0,
  totalErrors: 0,
  totalEvents: 0,
}

/**
 * A weekly rate is always computed over at least a full week, so a brand-new
 * account that practiced twice on its first day reads "2 per week" rather than
 * an extrapolated 14.
 */
export const WEEKLY_RATE_MINIMUM_DAYS = 7

function summarize(sessions: PracticeSessionRecord[], spanDays: number): WindowSummary {
  if (sessions.length === 0) {
    return EMPTY_SUMMARY
  }

  let totalMs = 0
  let totalSuccess = 0
  let totalErrors = 0
  let totalEvents = 0
  let completedCount = 0
  let totalResponseMs = 0
  let responseCount = 0

  for (const session of sessions) {
    totalMs += session.durationMs
    totalSuccess += session.successPercent
    totalErrors += session.errorCount
    totalEvents += session.totalEvents
    if (session.completed) {
      completedCount += 1
    }
    // Weighted by how many responses each session contributed, so one long
    // session doesn't count the same as a three-note one.
    totalResponseMs += session.notes.averageResponseMs * session.notes.responseCount
    responseCount += session.notes.responseCount
  }

  // Grouped over the window's own sessions: a sitting that straddles the
  // window's edge is simply cut at it, which beats reaching outside the window
  // and reporting practice time that isn't in it.
  const blocks = groupPracticeBlocks(sessions)
  const weeks = Math.max(spanDays, WEEKLY_RATE_MINIMUM_DAYS) / 7
  return {
    blockCount: blocks.length,
    blocksPerWeek: blocks.length / weeks,
    averageBlockMs: Math.round(totalMs / blocks.length),
    longestBlockMs: blocks.reduce((longest, block) => Math.max(longest, block.durationMs), 0),
    sessionCount: sessions.length,
    completedCount,
    totalMs,
    minutesPerWeek: totalMs / 60000 / weeks,
    averageSuccessPercent: Math.round(totalSuccess / sessions.length),
    averageResponseMs: responseCount === 0 ? 0 : Math.round(totalResponseMs / responseCount),
    daysPracticed: new Set(sessions.map(sessionDay)).size,
    totalErrors,
    totalEvents,
  }
}

/** Sessions started within the last `days` local calendar days, today included. */
export function sessionsInLastDays(
  sessions: PracticeSessionRecord[],
  days: number,
  now: Date = new Date(),
): PracticeSessionRecord[] {
  const oldestDay = dayNumber(localDayString(addDays(now, -(days - 1))))
  return sessions.filter((session) => dayNumber(sessionDay(session)) >= oldestDay)
}

export function summarizeRecent(
  sessions: PracticeSessionRecord[],
  days: number,
  now: Date = new Date(),
): WindowSummary {
  return summarize(sessionsInLastDays(sessions, days, now), days)
}

/**
 * All-time rates are spread over the days since the first session (not since
 * some fixed epoch), so "sessions per week" answers "how often do I practice
 * when I'm practicing at all" rather than being diluted by a long-dead account.
 */
export function summarizeAllTime(sessions: PracticeSessionRecord[], now: Date = new Date()): WindowSummary {
  if (sessions.length === 0) {
    return EMPTY_SUMMARY
  }
  const days = sessions.map(sessionDay).sort()
  const spanDays = dayNumber(localDayString(now)) - dayNumber(days[0]) + 1
  return summarize(sessions, spanDays)
}

/**
 * Recent value against the all-time baseline, as a signed percentage. Null when
 * there is no baseline to compare against (nothing recorded outside the recent
 * window yet), which the UI shows as "no comparison" instead of a fake +100%.
 */
export function percentChange(recent: number, baseline: number): number | null {
  if (baseline === 0) {
    return null
  }
  return Math.round(((recent - baseline) / baseline) * 100)
}

export interface DayMinutes {
  /** YYYY-MM-DD, local. */
  day: string
  minutes: number
  sessionCount: number
  /**
   * The same minutes split by what was being done, so a day's bar can be read
   * as "20 minutes of score and 10 of reading" rather than as 30 undifferentiated
   * minutes. Sums to `minutes` (bar rounding aside).
   */
  byActivity: Record<ActivityKind, number>
}

function emptyActivityMinutes(): Record<ActivityKind, number> {
  return { score: 0, exercise: 0, reading: 0 }
}

/**
 * Minutes practiced per local day, oldest first, including days with nothing on
 * them (an empty bar is the point of the chart). A session counts entirely on
 * the day it started -- splitting one that crosses midnight would be precision
 * nobody reads off a bar chart.
 */
export function dailyMinutes(sessions: PracticeSessionRecord[], days: number, now: Date = new Date()): DayMinutes[] {
  const byDay = new Map<string, { minutes: number; sessionCount: number; byActivity: Record<ActivityKind, number> }>()
  for (const session of sessions) {
    const day = sessionDay(session)
    const existing = byDay.get(day) ?? { minutes: 0, sessionCount: 0, byActivity: emptyActivityMinutes() }
    const minutes = session.durationMs / 60000
    existing.byActivity[session.source.kind] += minutes
    byDay.set(day, {
      minutes: existing.minutes + minutes,
      sessionCount: existing.sessionCount + 1,
      byActivity: existing.byActivity,
    })
  }

  const round = (value: number) => Math.round(value * 10) / 10
  const result: DayMinutes[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = localDayString(addDays(now, -offset))
    const entry = byDay.get(day)
    result.push({
      day,
      minutes: entry ? round(entry.minutes) : 0,
      sessionCount: entry?.sessionCount ?? 0,
      byActivity: entry
        ? { score: round(entry.byActivity.score), exercise: round(entry.byActivity.exercise), reading: round(entry.byActivity.reading) }
        : emptyActivityMinutes(),
    })
  }
  return result
}

export interface ScoreProgress {
  /** catalogId when the score came from the library, else its scoreName --
   * see SessionSource, the same identity used to tell two sheets apart. */
  key: string
  /** From the most recently played session on this sheet, in case the
   * catalog title was edited after an earlier session was recorded. */
  title: string
  sessionCount: number
  bestSuccessPercent: number
  lastPlayedAt: string
}

/**
 * Every real score (not a generated exercise) with at least one session,
 * each with the best first-try accuracy ever reached on it -- a sheet never
 * attempted has no session to group, so it never appears here.
 */
export function summarizeScores(sessions: PracticeSessionRecord[]): ScoreProgress[] {
  const byKey = new Map<string, ScoreProgress>()
  for (const session of sessions) {
    if (session.source.kind !== 'score') {
      continue
    }
    const key = session.source.catalogId ?? session.source.scoreName
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        key,
        title: session.source.title,
        sessionCount: 1,
        bestSuccessPercent: session.successPercent,
        lastPlayedAt: session.startedAt,
      })
      continue
    }
    existing.sessionCount += 1
    existing.bestSuccessPercent = Math.max(existing.bestSuccessPercent, session.successPercent)
    if (session.startedAt > existing.lastPlayedAt) {
      existing.lastPlayedAt = session.startedAt
      existing.title = session.source.title
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt))
}

/** The three kinds of thing a session can be, straight from `SessionSource`. */
export type ActivityKind = 'score' | 'exercise' | 'reading'

export interface ActivityTime {
  kind: ActivityKind
  totalMs: number
  sessionCount: number
}

/**
 * Practice time split by what was being done. Deliberately NOT folded into one
 * total: a week of reading quizzes on a phone must not read as a week at the
 * keyboard, which is the whole reason a quiz is recorded with its own
 * `SessionSource` kind rather than as just another session.
 *
 * The order is fixed (scores, then keyboard exercises, then reading) so the
 * rows do not reshuffle as the balance between them changes.
 */
export function timeByActivity(sessions: PracticeSessionRecord[]): ActivityTime[] {
  const order: ActivityKind[] = ['score', 'exercise', 'reading']
  const totals = new Map<ActivityKind, ActivityTime>(
    order.map((kind) => [kind, { kind, totalMs: 0, sessionCount: 0 }]),
  )
  for (const session of sessions) {
    const entry = totals.get(session.source.kind)
    if (!entry) {
      continue
    }
    entry.totalMs += session.durationMs
    entry.sessionCount += 1
  }
  return order.map((kind) => totals.get(kind) as ActivityTime)
}

export function bestCombo(sessions: PracticeSessionRecord[]): number {
  return sessions.reduce((best, session) => Math.max(best, session.maxCombo), 0)
}
