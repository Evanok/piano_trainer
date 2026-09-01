import { Fragment, useEffect, useMemo, useState } from 'react'
import { isGuest } from '../api/auth'
import { fetchSessions, syncSessions } from '../api/stats'
import { computeGrade } from '../engine/grade'
import { countedSessions, mergeSessionLogs } from '../engine/sessionLog'
import { getSessions, replaceSessions } from '../engine/sessionStore'
import {
  bestCombo,
  computeStreak,
  dailyMinutes,
  groupPracticeBlocks,
  percentChange,
  sessionsInLastDays,
  summarizeAllTime,
  summarizeRecent,
  timeByActivity,
  summarizeScores,
  type PracticeBlock,
  type ActivityTime,
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

function StatCard({ label, value, tone }: { label: string; value: string | number; tone: StatTone }) {
  return (
    <div className={`rounded-xl border p-4 ${STAT_TONES[tone]}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</dt>
      <dd className="mt-1 text-2xl font-bold">{value}</dd>
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
}

function buildComparison(recent: WindowSummary, allTime: WindowSummary): ComparisonRow[] {
  return [
    {
      label: 'Practice sessions per week',
      recent: Math.round(recent.blocksPerWeek).toString(),
      allTime: Math.round(allTime.blocksPerWeek).toString(),
      change: percentChange(recent.blocksPerWeek, allTime.blocksPerWeek),
    },
    {
      label: 'Average practice session',
      recent: formatSessionLength(recent.averageBlockMs),
      allTime: formatSessionLength(allTime.averageBlockMs),
      change: percentChange(recent.averageBlockMs, allTime.averageBlockMs),
    },
    {
      label: 'Minutes per week',
      recent: Math.round(recent.minutesPerWeek).toString(),
      allTime: Math.round(allTime.minutesPerWeek).toString(),
      change: percentChange(recent.minutesPerWeek, allTime.minutesPerWeek),
    },
    {
      label: 'First-try accuracy',
      recent: `${recent.averageSuccessPercent}%`,
      allTime: `${allTime.averageSuccessPercent}%`,
      change: percentChange(recent.averageSuccessPercent, allTime.averageSuccessPercent),
    },
  ]
}

const ACTIVITY_LABELS: Record<ActivityTime['kind'], string> = {
  score: 'Scores',
  exercise: 'Keyboard exercises',
  reading: 'Reading and note order',
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

function dayTitle(entry: DayMinutes): string {
  if (entry.minutes === 0) {
    return `${entry.day}: nothing`
  }
  const parts = ACTIVITY_ORDER.filter((kind) => entry.byActivity[kind] > 0).map(
    (kind) => `${entry.byActivity[kind]} min ${ACTIVITY_LABELS[kind].toLowerCase()}`,
  )
  return `${entry.day}: ${parts.join(', ')}`
}

function CompletionCell({ session }: { session: PracticeSessionRecord }) {
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
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">{session.successPercent}%</td>
      <td className="whitespace-nowrap py-1.5 text-xs">{session.errorCount}</td>
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
      <td className="whitespace-nowrap py-2 pr-4">{block.successPercent}%</td>
      <td className="whitespace-nowrap py-2">{block.errorCount}</td>
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
        // A guest reads the shared history but never pushes into it, so it
        // pulls instead of syncing. Merging rather than replacing keeps a
        // device that has its own local history from losing it just because
        // someone opened a guest link in that browser.
        const guest = isGuest()
        const remote = guest ? await fetchSessions() : await syncSessions(getSessions())
        if (cancelled) {
          return
        }
        const merged = guest ? mergeSessionLogs(getSessions(), remote) : remote
        replaceSessions(merged)
        setSessions(merged)
        setSyncState(guest ? 'guest' : 'synced')
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
            <StatCard label="Streak" value={view.streak.currentStreak} tone="streak" />
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
              <section className={`p-4 ${PAGE_CARD}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-sm font-semibold text-gray-900">Last {RECENT_WINDOW_DAYS} days vs all time</h2>
                  <span className="text-xs text-gray-500">
                    best streak {view.streak.longestStreak} - grade {computeGrade(view.allTime.averageSuccessPercent)}
                  </span>
                </div>
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
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                      {comparison.map((row) => (
                        <tr key={row.label}>
                          <td className="whitespace-nowrap py-2 pr-4">{row.label}</td>
                          <td className="whitespace-nowrap py-2 pr-4 font-medium text-gray-900">{row.recent}</td>
                          <td className="whitespace-nowrap py-2 pr-4">{row.allTime}</td>
                          <td className="whitespace-nowrap py-2">
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
                            <td className="whitespace-nowrap py-2 pr-4">{score.bestSuccessPercent}%</td>
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
