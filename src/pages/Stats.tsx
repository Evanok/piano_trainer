import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { isGuest } from '../api/auth'
import { syncLocalSessionLog } from '../api/stats'
import { countedSessions, isGradedSession } from '../engine/sessionLog'
import { getSessions } from '../engine/sessionStore'
import {
  bestCombo,
  computeStreak,
  dailyMinutes,
  groupPracticeBlocks,
  localDayString,
  percentChange,
  practiceCalendar,
  sessionsInLastDays,
  summarizeAllTime,
  summarizeRecent,
  timeByActivity,
  summarizeScores,
  type PracticeBlock,
  type ActivityTime,
  type CalendarWeek,
  type DayMinutes,
  type WindowSummary,
} from '../engine/statsAnalytics'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  ACTIVITY_BARS,
  ACTIVITY_ORDER,
  ACTIVITY_TONES,
  PAGE_BACKGROUND,
  PAGE_CARD,
  STAT_TONES,
  type StatTone,
} from '../theme'
import type { PracticeSessionRecord } from '../types/session'

interface StatsProps {
  onBack: () => void
}

const RECENT_WINDOW_DAYS = 7
const CHART_DAYS = 14
const CALENDAR_WEEKS = 53
const VISIBLE_BLOCK_ROWS = 12

type SyncState = 'syncing' | 'synced' | 'guest' | 'local'

const PRACTICE_MODE_LABELS: Record<string, string> = {
  page: 'Page',
  scroll: 'Scroll',
  scrollLoop: 'Scroll loop',
  sectionFree: 'Sections',
  sectionTraining: 'Section training',
}

/**
 * A screen drill has no practice mode at all (no score to navigate, no hands),
 * so the column names the activity instead of leaving a blank cell.
 */
function activityLabel(session: PracticeSessionRecord): string {
  if (session.source.kind === 'reading') {
    return 'Reading quiz'
  }
  if (session.source.kind === 'sequence') {
    return 'Note order'
  }
  if (session.source.kind === 'chord') {
    return 'Chords'
  }
  return session.practiceMode ? (PRACTICE_MODE_LABELS[session.practiceMode] ?? session.practiceMode) : '-'
}

function formatClock(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 60) {
    return `${totalMinutes} min`
  }
  const hours = Math.floor(totalMinutes / 60)
  return `${hours}h ${String(totalMinutes % 60).padStart(2, '0')}m`
}

/** Session lengths are read in minutes, but a 40-second drill isn't "0 min". */
function formatSessionLength(ms: number): string {
  return ms < 60000 ? '<1 min' : `${Math.round(ms / 60000)} min`
}

function formatResponse(ms: number): string {
  if (ms <= 0) {
    return '-'
  }
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function StatCard({
  label,
  value,
  tone,
  detail,
}: {
  label: string
  value: string | number
  tone: StatTone
  detail?: string
}) {
  return (
    <div className={`rounded-xl border p-4 ${STAT_TONES[tone]}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</dt>
      <dd className="mt-1 text-2xl font-bold">{value}</dd>
      {detail && <dd className="mt-0.5 text-xs font-medium opacity-80">{detail}</dd>}
    </div>
  )
}

/**
 * Recent value against the all-time baseline. Every metric compared here is
 * "higher is better", so one shared color rule works for all of them.
 */
function DeltaChip({ change }: { change: number | null }) {
  if (change === null) {
    return <span className="text-xs text-gray-400">no baseline</span>
  }
  const tone = change > 0 ? 'bg-green-100 text-green-700' : change < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
  const sign = change > 0 ? '+' : ''
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{`${sign}${change}%`}</span>
}

interface ComparisonRow {
  label: string
  recent: string
  allTime: string
  change: number | null
  /** A breakdown of the row above it, drawn indented and lighter. */
  detail?: boolean
}

function durationRow(label: string, recentMs: number, allTimeMs: number, detail?: boolean): ComparisonRow {
  return {
    label,
    recent: formatSessionLength(recentMs),
    allTime: formatSessionLength(allTimeMs),
    change: percentChange(recentMs, allTimeMs),
    detail,
  }
}

/**
 * An average duration, then the same average split between time at the piano
 * (scores and keyboard exercises) and the screen drills, labelled theory
 * exercises. The total stays the headline because a day of quizzes is still a
 * day of practice; the split is there so a week that grew only on the phone
 * does not pass for one at the piano.
 */
function durationRows(
  label: string,
  recentMs: number,
  allTimeMs: number,
  recentByActivity: Record<ActivityTime['kind'], number>,
  allTimeByActivity: Record<ActivityTime['kind'], number>,
): ComparisonRow[] {
  const atPiano = (byActivity: Record<ActivityTime['kind'], number>) => byActivity.score + byActivity.exercise
  return [
    durationRow(label, recentMs, allTimeMs),
    durationRow('At the piano', atPiano(recentByActivity), atPiano(allTimeByActivity), true),
    durationRow('Theory exercises', recentByActivity.reading, allTimeByActivity.reading, true),
  ]
}

/**
 * The practice day leads: it is the number that answers "how much do I
 * practice". The per-sitting average follows it without a breakdown, since it
 * mostly measures how the day was cut up and read alone it can fall on a week
 * that grew (more, shorter sittings).
 */
function buildComparison(recent: WindowSummary, allTime: WindowSummary): ComparisonRow[] {
  return [
    ...durationRows(
      'Average practice day',
      recent.averageDayMs,
      allTime.averageDayMs,
      recent.averageDayMsByActivity,
      allTime.averageDayMsByActivity,
    ),
    durationRow('Average practice session', recent.averageBlockMs, allTime.averageBlockMs),
    {
      label: 'Practice sessions per week',
      recent: Math.round(recent.blocksPerWeek).toString(),
      allTime: Math.round(allTime.blocksPerWeek).toString(),
      change: percentChange(recent.blocksPerWeek, allTime.blocksPerWeek),
    },
    {
      label: 'Minutes per week',
      recent: Math.round(recent.minutesPerWeek).toString(),
      allTime: Math.round(allTime.minutesPerWeek).toString(),
      change: percentChange(recent.minutesPerWeek, allTime.minutesPerWeek),
    },
  ]
}

const ACTIVITY_LABELS: Record<ActivityTime['kind'], string> = {
  score: 'Scores',
  exercise: 'Keyboard exercises',
  reading: 'Theory exercises',
}

function ActivityLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {ACTIVITY_ORDER.map((kind) => (
        <span key={kind} className="flex items-center gap-1 text-[10px] text-gray-500">
          <span className={`h-2 w-2 rounded-sm ${ACTIVITY_BARS[kind]}`} />
          {ACTIVITY_LABELS[kind]}
        </span>
      ))}
    </div>
  )
}

/**
 * One bar per day, stacked by what the day was spent on. A day of nothing but
 * scores looks exactly as the whole chart did before the split, which is the
 * point: the colours only appear once there is something to tell apart.
 */
function PracticeChart({ days }: { days: DayMinutes[] }) {
  const peak = Math.max(...days.map((entry) => entry.minutes), 1)
  return (
    <section className={`p-4 ${PAGE_CARD}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-indigo-700">Minutes practiced, last {days.length} days</h2>
        <ActivityLegend />
      </div>
      <div className="mt-4 flex h-32 items-end gap-1">
        {days.map((entry) => (
          <div key={entry.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            {/* Rounding alone would label a 20-second day "0" while still
                drawing it a bar, since the scale's peak is that same day. */}
            <span className="text-[10px] text-gray-400">
              {entry.minutes === 0 ? '' : entry.minutes < 1 ? '<1' : Math.round(entry.minutes)}
            </span>
            <div
              className={`w-full overflow-hidden rounded-t ${entry.minutes > 0 ? '' : 'bg-indigo-100'}`}
              // A day with nothing on it still gets a sliver of bar, so the
              // baseline reads as a row of days rather than a gap in the chart.
              style={{ height: `${entry.minutes > 0 ? Math.max(6, (entry.minutes / peak) * 100) : 2}%` }}
              title={dayTitle(entry)}
            >
              {/* Reversed, so the first kind of the shared order sits at the
                  bottom of the stack rather than at the top. */}
              <div className="flex h-full w-full flex-col-reverse">
                {ACTIVITY_ORDER.map((kind) =>
                  entry.byActivity[kind] > 0 ? (
                    <div
                      key={kind}
                      className={ACTIVITY_BARS[kind]}
                      style={{ height: `${(entry.byActivity[kind] / entry.minutes) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
            </div>
            <span className="text-[10px] text-gray-500">{entry.day.slice(8)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * The calendar's colours, read like a habit tracker: green is a real practice
 * day (darker for longer), orange a day that only just counted, grey a day
 * with nothing on it. Missed days are deliberately grey rather than red: on a
 * page opened for motivation, a wall of red is what the eye goes to first.
 * Days before the first session ever recorded are hatched instead, since the
 * app was not in use yet and nothing could have been played there.
 */
const SHORT_DAY_MAX_MINUTES = 10

const CALENDAR_GREENS = [
  { minMinutes: 40, tone: 'bg-green-700', label: '40+ min' },
  { minMinutes: 20, tone: 'bg-green-500', label: '20-40 min' },
  { minMinutes: SHORT_DAY_MAX_MINUTES, tone: 'bg-green-300', label: '10-20 min' },
]

const CALENDAR_SHORT_TONE = 'bg-orange-300'
const CALENDAR_MISSED_TONE = 'bg-gray-200'
const CALENDAR_BEFORE_TONE =
  'bg-[repeating-linear-gradient(135deg,#d1d5db_0_1.5px,transparent_1.5px_4px)] bg-gray-50'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function calendarTone(entry: DayMinutes, firstDay: string | null): string {
  if (entry.sessionCount > 0) {
    return CALENDAR_GREENS.find((level) => entry.minutes >= level.minMinutes)?.tone ?? CALENDAR_SHORT_TONE
  }
  // Day strings are YYYY-MM-DD, so they order as strings.
  if (firstDay === null || entry.day < firstDay) {
    return CALENDAR_BEFORE_TONE
  }
  return CALENDAR_MISSED_TONE
}

/**
 * The month a week column starts, shown only where it changes. The first
 * column is usually a partial month, and naming it would crowd the label of
 * the next one a column or two later.
 */
function monthLabel(weeks: CalendarWeek[], index: number): string | null {
  const month = (week: CalendarWeek) => Number(week[0]?.day.slice(5, 7)) - 1
  if (index === 0 || month(weeks[index]) === month(weeks[index - 1])) {
    return null
  }
  return MONTH_LABELS[month(weeks[index])]
}

/**
 * A year of practice days, one column per week, Monday at the top. Same
 * counted sessions as the streak, so a coloured square is exactly a day the
 * streak counted. The grid is wider than a phone, so it opens scrolled to
 * today and the past is a swipe to the left.
 */
function PracticeCalendar({ weeks, firstDay }: { weeks: CalendarWeek[]; firstDay: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = scrollRef.current
    if (element) {
      element.scrollLeft = element.scrollWidth
    }
  }, [])
  const today = weeks[weeks.length - 1].filter((day) => day !== null).at(-1)?.day
  const practicedDays = weeks.flat().filter((day) => day !== null && day.sessionCount > 0).length
  return (
    <section className={`p-4 ${PAGE_CARD}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-green-700">Practice days</h2>
        <span className="text-xs text-gray-500">
          {practicedDays} {practicedDays === 1 ? 'day' : 'days'} in the last year
        </span>
      </div>
      <div ref={scrollRef} className="mt-3 overflow-x-auto pb-1">
        <div className="flex w-max gap-[3px]">
          {/* Pinned, so the weekday names stay readable once the past is scrolled into view. */}
          <div className="sticky left-0 z-10 flex flex-col gap-[3px] bg-white pr-1 text-[10px] leading-3 text-gray-400">
            {['', 'Mon', '', 'Wed', '', 'Fri', '', ''].map((label, index) => (
              <span key={index} className="h-3">
                {label}
              </span>
            ))}
          </div>
          {weeks.map((week, index) => (
            <div key={week[0]?.day ?? index} className="flex flex-col gap-[3px]">
              <span className="h-3 w-3 overflow-visible whitespace-nowrap text-[10px] leading-3 text-gray-400">
                {monthLabel(weeks, index) ?? ''}
              </span>
              {week.map((entry, dayIndex) =>
                entry === null ? (
                  <div key={dayIndex} className="h-3 w-3" />
                ) : (
                  <div
                    key={entry.day}
                    className={`h-3 w-3 rounded-sm ${calendarTone(entry, firstDay)} ${
                      entry.day === today ? 'ring-1 ring-gray-500 ring-offset-1' : ''
                    }`}
                    title={dayTitle(entry)}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-gray-500">
        {[
          { tone: CALENDAR_MISSED_TONE, label: 'no practice' },
          { tone: CALENDAR_SHORT_TONE, label: `under ${SHORT_DAY_MAX_MINUTES} min` },
          ...[...CALENDAR_GREENS].reverse(),
        ].map(({ tone, label }) => (
          <span key={tone} className="flex items-center gap-1">
            <span className={`h-3 w-3 rounded-sm ${tone}`} />
            {label}
          </span>
        ))}
      </div>
    </section>
  )
}

function dayTitle(entry: DayMinutes): string {
  if (entry.minutes === 0) {
    return `${entry.day}: nothing`
  }
  const parts = ACTIVITY_ORDER.filter((kind) => entry.byActivity[kind] > 0).map(
    (kind) => `${entry.byActivity[kind]} min ${ACTIVITY_LABELS[kind].toLowerCase()}`,
  )
  return `${entry.day}: ${parts.join(', ')}`
}

/** What a cell shows for a figure the session never measured. */
const NOT_MEASURED = '-'

function CompletionCell({ session }: { session: PracticeSessionRecord }) {
  if (!isGradedSession(session)) {
    return <span className="text-xs text-gray-400">{NOT_MEASURED}</span>
  }
  return session.completed ? (
    <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">completed</span>
  ) : (
    <span className="text-xs text-gray-500">
      {session.eventsPlayed}/{session.totalEvents}
    </span>
  )
}

/**
 * Practice time split by what was being done, never merged into one total: time
 * at the keyboard and time naming notes on a phone are different things, and a
 * run of quizzes must not be readable as a run of playing.
 */
function ActivitySplit({ recent, allTime }: { recent: ActivityTime[]; allTime: ActivityTime[] }) {
  const total = allTime.reduce((sum, entry) => sum + entry.totalMs, 0)
  return (
    <section className={`p-4 ${PAGE_CARD}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-gray-900">Where the time goes</h2>
        <span className="text-xs text-gray-500">last {RECENT_WINDOW_DAYS} days and all time</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {allTime.map((entry, index) => {
          const share = total === 0 ? 0 : Math.round((entry.totalMs / total) * 100)
          return (
            <li key={entry.kind} className="flex items-center gap-3 text-sm">
              <span
                className={`w-40 shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${ACTIVITY_TONES[entry.kind]}`}
              >
                {ACTIVITY_LABELS[entry.kind]}
              </span>
              <span className="w-20 shrink-0 text-xs text-gray-500">
                {formatClock(recent[index]?.totalMs ?? 0)}
              </span>
              <span className="w-20 shrink-0 font-medium text-gray-900">{formatClock(entry.totalMs)}</span>
              <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-gray-100 sm:block">
                <span className="block h-full rounded-full bg-indigo-400" style={{ width: `${share}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right text-xs text-gray-500">{share}%</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** One piece worked, nested under the sitting it belongs to. */
function SessionRow({ session }: { session: PracticeSessionRecord }) {
  return (
    <tr className="bg-indigo-50/50 text-gray-600">
      <td className="py-1.5 pr-4" />
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">{formatTime(session.startedAt)}</td>
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">{formatSessionLength(session.durationMs)}</td>
      <td className="max-w-72 truncate py-1.5 pr-4 pl-4 text-xs" title={session.source.title}>
        {session.source.title}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">
        {activityLabel(session)}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4">
        <CompletionCell session={session} />
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">
        {isGradedSession(session) ? `${session.successPercent}%` : NOT_MEASURED}
      </td>
      <td className="whitespace-nowrap py-1.5 text-xs">{isGradedSession(session) ? session.errorCount : NOT_MEASURED}</td>
    </tr>
  )
}

/**
 * One sitting at the piano. A sitting that only ever touched one piece names it
 * directly and has nothing worth unfolding, so only multi-piece sittings get a
 * toggle -- otherwise the common case costs an extra row that repeats itself.
 */
function BlockRow({
  block,
  expanded,
  onToggle,
}: {
  block: PracticeBlock
  expanded: boolean
  onToggle: () => void
}) {
  const single = block.sessions.length === 1
  return (
    <tr className="font-medium text-gray-900">
      <td className="whitespace-nowrap py-2 pr-4">{formatDay(block.startedAt)}</td>
      <td className="whitespace-nowrap py-2 pr-4">{formatTime(block.startedAt)}</td>
      <td className="whitespace-nowrap py-2 pr-4">{formatSessionLength(block.durationMs)}</td>
      <td className="max-w-72 truncate py-2 pr-4">
        {single ? (
          <span title={block.sessions[0].source.title}>{block.sessions[0].source.title}</span>
        ) : (
          <button type="button" onClick={onToggle} className="flex items-center gap-1 hover:underline">
            <span className="text-gray-400">{expanded ? '-' : '+'}</span>
            {block.sessions.length} pieces
          </button>
        )}
      </td>
      <td className="whitespace-nowrap py-2 pr-4 font-normal text-gray-500">
        {single ? activityLabel(block.sessions[0]) : '-'}
      </td>
      <td className="whitespace-nowrap py-2 pr-4">
        {single ? (
          <CompletionCell session={block.sessions[0]} />
        ) : (
          <span className="text-xs font-normal text-gray-500">
            {block.completedCount}/{block.sessions.length} completed
          </span>
        )}
      </td>
      <td className="whitespace-nowrap py-2 pr-4">
        {block.successPercent === null ? NOT_MEASURED : `${block.successPercent}%`}
      </td>
      <td className="whitespace-nowrap py-2">{block.errorCount ?? NOT_MEASURED}</td>
    </tr>
  )
}

export function Stats({ onBack }: StatsProps) {
  const isMobile = useIsMobile()
  const [sessions, setSessions] = useState<PracticeSessionRecord[]>(() => getSessions())
  const [syncState, setSyncState] = useState<SyncState>('syncing')
  const [showAllSessions, setShowAllSessions] = useState(false)
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set())

  const toggleBlock = (id: string) => {
    setExpandedBlocks((expanded) => {
      const next = new Set(expanded)
      if (!next.delete(id)) {
        next.add(id)
      }
      return next
    })
  }

  // One round-trip on entering the screen: pushes what this device recorded and
  // pulls back what the others did (see api/stats.ts). A failure is not an error
  // worth interrupting anything for -- the local log is still shown, just without
  // the other devices' sessions in it.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const merged = await syncLocalSessionLog()
        if (cancelled) {
          return
        }
        setSessions(merged)
        setSyncState(isGuest() ? 'guest' : 'synced')
      } catch {
        if (!cancelled) {
          setSyncState('local')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // `sessions` stays the full log (that is what gets synced back); everything
  // shown here is derived from the practice-worthy ones only, in one place, so
  // the table, the chart, the streak and every average agree on what counts.
  const view = useMemo(() => {
    const now = new Date()
    const counted = countedSessions(sessions)
    const allTime = summarizeAllTime(counted, now)
    return {
      allTime,
      recent: summarizeRecent(counted, RECENT_WINDOW_DAYS, now),
      streak: computeStreak(counted, now),
      chart: dailyMinutes(counted, CHART_DAYS, now),
      calendar: practiceCalendar(counted, CALENDAR_WEEKS, now),
      // Days before the first session ever are not "missed", the app was not in use yet.
      firstDay: counted.length === 0 ? null : localDayString(new Date(Math.min(...counted.map((session) => Date.parse(session.startedAt))))),
      combo: bestCombo(counted),
      blocks: groupPracticeBlocks(counted),
      scores: summarizeScores(counted),
      // Two windows of the same split, so "am I only doing quizzes lately" is
      // answerable rather than being averaged away over the whole history.
      activityRecent: timeByActivity(sessionsInLastDays(counted, RECENT_WINDOW_DAYS, now)),
      activityAllTime: timeByActivity(counted),
    }
  }, [sessions])

  const comparison = buildComparison(view.recent, view.allTime)
  const visibleBlocks = showAllSessions ? view.blocks : view.blocks.slice(0, VISIBLE_BLOCK_ROWS)

  return (
    <div
      className={
        isMobile
          ? `flex h-screen w-full flex-col overflow-auto ${PAGE_BACKGROUND}`
          : `min-h-screen ${PAGE_BACKGROUND}`
      }
    >
      <div
        className={
          isMobile
            ? 'flex min-h-0 flex-1 flex-col px-4 py-3'
            : 'mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-8 py-10'
        }
      >
        <header className="flex shrink-0 items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="text-sm font-medium text-indigo-600 hover:underline">
            Home
          </button>
          <h1 className={isMobile ? 'text-2xl font-semibold text-gray-900' : 'text-3xl font-semibold text-gray-900'}>
            Stats
          </h1>
          <span className="w-24 text-right text-xs text-gray-400">
            {syncState === 'syncing'
              ? 'syncing...'
              : syncState === 'synced'
                ? 'all devices'
                : syncState === 'guest'
                  ? 'shared history'
                  : 'this device only'}
          </span>
        </header>

        <main className={isMobile ? 'mt-4 flex flex-col gap-4' : 'flex flex-col gap-6'}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Sessions" value={view.allTime.blockCount} tone="neutral" />
            <StatCard label="Total time" value={formatClock(view.allTime.totalMs)} tone="time" />
            <StatCard
              label="Streak"
              value={view.streak.currentStreak}
              tone="streak"
              detail={`record ${view.streak.longestStreak}`}
            />
            <StatCard label="Days practiced" value={view.streak.totalDaysPracticed} tone="days" />
            <StatCard label="Longest session" value={formatSessionLength(view.allTime.longestBlockMs)} tone="grade" />
            <StatCard label="Best combo" value={view.combo} tone="good" />
          </dl>

          {view.allTime.blockCount === 0 ? (
            <section className={`p-6 text-center ${PAGE_CARD}`}>
              <h2 className="text-lg font-medium text-gray-900">No practice recorded yet</h2>
              <p className="mt-2 text-sm text-gray-500">
                Every exercise and every score you practice is recorded here, finished or not.
              </p>
            </section>
          ) : (
            <>
              <PracticeCalendar weeks={view.calendar} firstDay={view.firstDay} />

              <section className={`p-4 ${PAGE_CARD}`}>
                <h2 className="text-sm font-semibold text-gray-900">Last {RECENT_WINDOW_DAYS} days vs all time</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-gray-500">
                      <tr>
                        <th className="py-2 pr-4 font-medium">Metric</th>
                        <th className="py-2 pr-4 font-medium">{RECENT_WINDOW_DAYS} days</th>
                        <th className="py-2 pr-4 font-medium">All time</th>
                        <th className="py-2 font-medium">Change</th>
                      </tr>
                    </thead>
                    {/* Separators drawn per row rather than with divide-y, so a
                        breakdown stays attached to the metric above it. */}
                    <tbody className="text-gray-700">
                      {comparison.map((row, index) => (
                        <tr
                          key={index}
                          className={
                            row.detail ? 'text-xs text-gray-500' : index > 0 ? 'border-t border-gray-100' : undefined
                          }
                        >
                          <td className={`whitespace-nowrap pr-4 ${row.detail ? 'py-1 pl-4' : 'py-2'}`}>{row.label}</td>
                          <td
                            className={`whitespace-nowrap pr-4 ${row.detail ? 'py-1' : 'py-2 font-medium text-gray-900'}`}
                          >
                            {row.recent}
                          </td>
                          <td className={`whitespace-nowrap pr-4 ${row.detail ? 'py-1' : 'py-2'}`}>{row.allTime}</td>
                          <td className={`whitespace-nowrap ${row.detail ? 'py-1' : 'py-2'}`}>
                            <DeltaChip change={row.change} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <ActivitySplit recent={view.activityRecent} allTime={view.activityAllTime} />

              <PracticeChart days={view.chart} />

              <section className={`p-4 ${PAGE_CARD}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-sm font-semibold text-gray-900">Practice sessions</h2>
                  <span className="text-xs text-gray-500">
                    {view.allTime.sessionCount} pieces worked - {view.allTime.completedCount} completed - avg response{' '}
                    {formatResponse(view.allTime.averageResponseMs)}
                  </span>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-gray-500">
                      <tr>
                        <th className="whitespace-nowrap py-2 pr-4 font-medium">Date</th>
                        <th className="whitespace-nowrap py-2 pr-4 font-medium">Start</th>
                        <th className="whitespace-nowrap py-2 pr-4 font-medium">Duration</th>
                        <th className="whitespace-nowrap py-2 pr-4 font-medium">What</th>
                        <th className="whitespace-nowrap py-2 pr-4 font-medium">Mode</th>
                        <th className="whitespace-nowrap py-2 pr-4 font-medium">Progress</th>
                        <th className="whitespace-nowrap py-2 pr-4 font-medium">Success</th>
                        <th className="whitespace-nowrap py-2 font-medium">Errors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                      {visibleBlocks.map((block) => (
                        <Fragment key={block.id}>
                          <BlockRow
                            block={block}
                            expanded={expandedBlocks.has(block.id)}
                            onToggle={() => toggleBlock(block.id)}
                          />
                          {expandedBlocks.has(block.id) &&
                            block.sessions.map((session) => <SessionRow key={session.id} session={session} />)}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                {view.blocks.length > VISIBLE_BLOCK_ROWS && (
                  <button
                    type="button"
                    onClick={() => setShowAllSessions((shown) => !shown)}
                    className="mt-3 text-sm text-gray-500 hover:underline"
                  >
                    {showAllSessions ? 'Show fewer' : `Show all ${view.blocks.length}`}
                  </button>
                )}
              </section>

              {view.scores.length > 0 && (
                <section className={`p-4 ${PAGE_CARD}`}>
                  <h2 className="text-sm font-semibold text-gray-900">Scores you've played</h2>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs uppercase text-gray-500">
                        <tr>
                          <th className="py-2 pr-4 font-medium">Title</th>
                          <th className="whitespace-nowrap py-2 pr-4 font-medium">Times played</th>
                          <th className="whitespace-nowrap py-2 pr-4 font-medium">Best accuracy</th>
                          <th className="whitespace-nowrap py-2 font-medium">Last played</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-700">
                        {view.scores.map((score) => (
                          <tr key={score.key}>
                            <td className="max-w-72 truncate py-2 pr-4 font-medium text-gray-900" title={score.title}>
                              {score.title}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4">{score.sessionCount}</td>
                            <td className="whitespace-nowrap py-2 pr-4">{score.bestSuccessPercent === null ? NOT_MEASURED : `${score.bestSuccessPercent}%`}</td>
                            <td className="whitespace-nowrap py-2">{formatDay(score.lastPlayedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
