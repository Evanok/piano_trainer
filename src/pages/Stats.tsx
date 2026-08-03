import { useMemo, useState } from 'react'
import { computeGrade } from '../engine/grade'
import { getExerciseSessions, type StoredExerciseSession } from '../engine/exerciseStatsStore'
import { getStreakStats } from '../engine/streakStore'
import { useIsMobile } from '../hooks/useIsMobile'

interface StatsProps {
  onBack: () => void
}

interface CountItem {
  label: string
  count: number
}

interface ConfusionItem {
  expected: string
  played: string
  count: number
}

const MAX_LIST_ITEMS = 5
const RECENT_SESSION_COUNT = 8

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes + ':' + seconds.toString().padStart(2, '0')
}

function formatResponse(ms: number): string {
  if (ms <= 0) {
    return '-'
  }
  if (ms < 1000) {
    return Math.round(ms) + ' ms'
  }
  return (ms / 1000).toFixed(1) + ' s'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  )
}

function addCount(map: Map<string, number>, label: string, count: number): void {
  map.set(label, (map.get(label) ?? 0) + count)
}

function topCounts(map: Map<string, number>): CountItem[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LIST_ITEMS)
    .map(([label, count]) => ({ label, count }))
}

function summarizeSessions(sessions: StoredExerciseSession[]) {
  const missed = new Map<string, number>()
  const wrong = new Map<string, number>()
  const confusions = new Map<string, ConfusionItem>()

  let totalDurationMs = 0
  let totalErrors = 0
  let totalEvents = 0
  let totalSuccess = 0
  let totalResponseMs = 0
  let responseCount = 0
  let bestCombo = 0

  for (const session of sessions) {
    totalDurationMs += session.durationMs
    totalErrors += session.errorCount
    totalEvents += session.totalEvents
    totalSuccess += session.successPercent
    bestCombo = Math.max(bestCombo, session.maxCombo)

    totalResponseMs += session.exercise.averageResponseMs * session.exercise.responseCount
    responseCount += session.exercise.responseCount

    for (const item of session.exercise.missedNotes) {
      addCount(missed, item.note, item.count)
    }
    for (const item of session.exercise.wrongNotes) {
      addCount(wrong, item.note, item.count)
    }
    for (const item of session.exercise.confusions) {
      const key = item.expected + ' -> ' + item.played
      const existing = confusions.get(key)
      confusions.set(key, {
        expected: item.expected,
        played: item.played,
        count: (existing?.count ?? 0) + item.count,
      })
    }
  }

  return {
    sessionCount: sessions.length,
    totalDurationMs,
    totalErrors,
    totalEvents,
    averageSuccess: sessions.length === 0 ? 0 : Math.round(totalSuccess / sessions.length),
    averageResponseMs: responseCount === 0 ? 0 : Math.round(totalResponseMs / responseCount),
    bestCombo,
    missed: topCounts(missed),
    wrong: topCounts(wrong),
    confusions: Array.from(confusions.values())
      .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected) || a.played.localeCompare(b.played))
      .slice(0, MAX_LIST_ITEMS),
  }
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <dt className="text-xs uppercase text-gray-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-gray-900">{value}</dd>
    </div>
  )
}

function CountList({ title, items, emptyLabel }: { title: string; items: CountItem[]; emptyLabel: string }) {
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

export function Stats({ onBack }: StatsProps) {
  const isMobile = useIsMobile()
  const [sessions] = useState(() => getExerciseSessions())
  const [streak] = useState(() => getStreakStats())
  const summary = useMemo(() => summarizeSessions(sessions), [sessions])
  const recentSessions = sessions.slice(0, RECENT_SESSION_COUNT)

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
        <span className="w-10" />
      </header>

      <main className={isMobile ? 'mt-4 flex flex-col gap-4' : 'flex flex-col gap-6'}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Sessions" value={summary.sessionCount} />
          <StatCard label="Grade" value={summary.sessionCount === 0 ? '-' : computeGrade(summary.averageSuccess)} />
          <StatCard label="Success" value={summary.sessionCount === 0 ? '-' : summary.averageSuccess + '%'} />
          <StatCard label="Avg response" value={formatResponse(summary.averageResponseMs)} />
          <StatCard label="Best combo" value={summary.bestCombo} />
          <StatCard label="Streak" value={streak.currentStreak} />
        </dl>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="grid gap-3 text-center sm:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-gray-500">Total time</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{formatDuration(summary.totalDurationMs)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Total events</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{summary.totalEvents}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Total errors</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{summary.totalErrors}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Days practiced</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">{streak.totalDaysPracticed}</div>
            </div>
          </div>
        </section>

        {summary.sessionCount === 0 ? (
          <section className="rounded-lg border border-gray-200 bg-white p-6 text-center">
            <h2 className="text-lg font-medium text-gray-900">No exercise history yet</h2>
            <p className="mt-2 text-sm text-gray-500">Complete generated exercises to build note and response-time stats.</p>
          </section>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <CountList title="Missed expected" items={summary.missed} emptyLabel="No missed notes" />
              <CountList title="Wrong played" items={summary.wrong} emptyLabel="No wrong notes" />
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-900">Confusions</h2>
                {summary.confusions.length > 0 ? (
                  <ol className="mt-3 flex flex-col gap-2 text-sm text-gray-700">
                    {summary.confusions.map((item) => (
                      <li key={item.expected + ':' + item.played} className="flex items-center justify-between gap-3">
                        <span>{item.expected + ' -> ' + item.played}</span>
                        <span className="font-medium text-gray-900">x{item.count}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">No repeated confusions</p>
                )}
              </section>
            </div>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-sm font-semibold text-gray-900">Recent exercises</h2>
                <span className="text-xs text-gray-500">Last {recentSessions.length}</span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Date</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Score</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Success</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Errors</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">Avg response</th>
                      <th className="whitespace-nowrap py-2 font-medium">Combo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700">
                    {recentSessions.map((session) => (
                      <tr key={session.id}>
                        <td className="whitespace-nowrap py-2 pr-4">{formatDate(session.completedAt)}</td>
                        <td className="max-w-72 truncate py-2 pr-4">{session.scoreName}</td>
                        <td className="whitespace-nowrap py-2 pr-4">{session.successPercent}%</td>
                        <td className="whitespace-nowrap py-2 pr-4">{session.errorCount}</td>
                        <td className="whitespace-nowrap py-2 pr-4">{formatResponse(session.exercise.averageResponseMs)}</td>
                        <td className="whitespace-nowrap py-2">{session.maxCombo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
