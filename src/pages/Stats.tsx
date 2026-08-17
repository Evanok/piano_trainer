import { Fragment, useEffect, useMemo, useState } from 'react'
import { syncSessions } from '../api/stats'
import { computeGrade } from '../engine/grade'
import { getSessions, replaceSessions } from '../engine/sessionStore'
import {
  bestCombo,
  computeStreak,
  dailyMinutes,
  groupPracticeBlocks,
  percentChange,
  summarizeAllTime,
  summarizeNotes,
  summarizeRecent,
  type PracticeBlock,
  type WindowSummary,
} from '../engine/statsAnalytics'
import { useIsMobile } from '../hooks/useIsMobile'
import type { PracticeSessionRecord } from '../types/session'

interface StatsProps {
  onBack: () => void
}

const MAX_LIST_ITEMS = 5
const RECENT_WINDOW_DAYS = 7
const CHART_DAYS = 14
const VISIBLE_BLOCK_ROWS = 12

type SyncState = 'syncing' | 'synced' | 'local'

const PRACTICE_MODE_LABELS: Record<string, string> = {
  page: 'Page',
  scroll: 'Scroll',
  sectionFree: 'Sections',
  sectionTraining: 'Section training',
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <dt className="text-xs uppercase text-gray-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-gray-900">{value}</dd>
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
      recent: recent.blocksPerWeek.toFixed(1),
      allTime: allTime.blocksPerWeek.toFixed(1),
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

function PracticeChart({ days }: { days: { day: string; minutes: number }[] }) {
  const peak = Math.max(...days.map((entry) => entry.minutes), 1)
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Minutes practiced, last {days.length} days</h2>
      <div className="mt-4 flex h-32 items-end gap-1">
        {days.map((entry) => (
          <div key={entry.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            {/* Rounding alone would label a 20-second day "0" while still
                drawing it a bar, since the scale's peak is that same day. */}
            <span className="text-[10px] text-gray-400">
              {entry.minutes === 0 ? '' : entry.minutes < 1 ? '<1' : Math.round(entry.minutes)}
            </span>
            <div
              className={`w-full rounded-t ${entry.minutes > 0 ? 'bg-indigo-500' : 'bg-gray-100'}`}
              // A day with nothing on it still gets a sliver of bar, so the
              // baseline reads as a row of days rather than a gap in the chart.
              style={{ height: `${entry.minutes > 0 ? Math.max(6, (entry.minutes / peak) * 100) : 2}%` }}
              title={`${entry.day}: ${entry.minutes} min`}
            />
            <span className="text-[10px] text-gray-500">{entry.day.slice(8)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function CountList({
  title,
  items,
  emptyLabel,
}: {
  title: string
  items: { label: string; count: number }[]
  emptyLabel: string
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {items.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-2 text-sm text-gray-700">
          {items.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3">
              <span>{item.label}</span>
              <span className="font-medium text-gray-900">x{item.count}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-gray-500">{emptyLabel}</p>
      )}
    </section>
  )
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

/** One piece worked, nested under the sitting it belongs to. */
function SessionRow({ session }: { session: PracticeSessionRecord }) {
  return (
    <tr className="bg-gray-50/60 text-gray-600">
      <td className="py-1.5 pr-4" />
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">{formatTime(session.startedAt)}</td>
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">{formatSessionLength(session.durationMs)}</td>
      <td className="max-w-72 truncate py-1.5 pr-4 pl-4 text-xs" title={session.source.title}>
        {session.source.title}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-4 text-xs">
        {PRACTICE_MODE_LABELS[session.practiceMode] ?? session.practiceMode}
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
        {single ? (PRACTICE_MODE_LABELS[block.sessions[0].practiceMode] ?? block.sessions[0].practiceMode) : '-'}
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
        const merged = await syncSessions(getSessions())
        if (cancelled) {
          return
        }
        replaceSessions(merged)
        setSessions(merged)
        setSyncState('synced')
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

  const view = useMemo(() => {
    const now = new Date()
    const allTime = summarizeAllTime(sessions, now)
    return {
      allTime,
      recent: summarizeRecent(sessions, RECENT_WINDOW_DAYS, now),
      streak: computeStreak(sessions, now),
      chart: dailyMinutes(sessions, CHART_DAYS, now),
      notes: summarizeNotes(sessions, MAX_LIST_ITEMS),
      combo: bestCombo(sessions),
      blocks: groupPracticeBlocks(sessions),
    }
  }, [sessions])

  const comparison = buildComparison(view.recent, view.allTime)
  const visibleBlocks = showAllSessions ? view.blocks : view.blocks.slice(0, VISIBLE_BLOCK_ROWS)

  return (
    <div
      className={
        isMobile
          ? 'flex h-screen w-full flex-col overflow-auto bg-gray-100 px-4 py-3'
          : 'mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-8 py-10'
      }
    >
      <header className="flex shrink-0 items-center justify-between gap-4">
        <button type="button" onClick={onBack} className="text-sm text-gray-500 hover:underline">
          Home
        </button>
        <h1 className={isMobile ? 'text-2xl font-semibold text-gray-900' : 'text-3xl font-semibold text-gray-900'}>
          Stats
        </h1>
        <span className="w-24 text-right text-xs text-gray-400">
          {syncState === 'syncing' ? 'syncing...' : syncState === 'synced' ? 'all devices' : 'this device only'}
        </span>
      </header>

      <main className={isMobile ? 'mt-4 flex flex-col gap-4' : 'flex flex-col gap-6'}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Sessions" value={view.allTime.blockCount} />
          <StatCard label="Total time" value={formatClock(view.allTime.totalMs)} />
          <StatCard label="Streak" value={view.streak.currentStreak} />
          <StatCard label="Days practiced" value={view.streak.totalDaysPracticed} />
          <StatCard label="Longest session" value={formatSessionLength(view.allTime.longestBlockMs)} />
          <StatCard label="Best combo" value={view.combo} />
        </dl>

        {view.allTime.blockCount === 0 ? (
          <section className="rounded-lg border border-gray-200 bg-white p-6 text-center">
            <h2 className="text-lg font-medium text-gray-900">No practice recorded yet</h2>
            <p className="mt-2 text-sm text-gray-500">
              Every exercise and every score you practice is recorded here, finished or not.
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-lg border border-gray-200 bg-white p-4">
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

            <PracticeChart days={view.chart} />

            <div className="grid gap-4 lg:grid-cols-3">
              <CountList
                title="Missed expected"
                items={view.notes.missed.map((item) => ({ label: item.note, count: item.count }))}
                emptyLabel="No missed notes"
              />
              <CountList
                title="Wrong played"
                items={view.notes.wrong.map((item) => ({ label: item.note, count: item.count }))}
                emptyLabel="No wrong notes"
              />
              <CountList
                title="Confusions"
                items={view.notes.confusions.map((item) => ({
                  label: `${item.expected} -> ${item.played}`,
                  count: item.count,
                }))}
                emptyLabel="No repeated confusions"
              />
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
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
          </>
        )}
      </main>
    </div>
  )
}
