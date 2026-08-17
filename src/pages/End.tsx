import { computeGrade } from '../engine/grade'
import { getStreakStats } from '../engine/streak'
import type { SessionStats } from '../types/session'

interface EndProps {
  stats: SessionStats
  onHome: () => void
  onNextExercise?: () => void
  onChangeSettings?: () => void
  /** Re-enters Practice with the same score, from the start. Score sessions only. */
  onReplay?: () => void
  /** Score sessions only -- there's no equivalent "catalog" for a generated exercise. */
  onBackToCatalog?: () => void
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes + ':' + seconds.toString().padStart(2, '0')
}

function formatResponse(ms: number): string {
  if (ms < 1000) {
    return ms + ' ms'
  }
  return (ms / 1000).toFixed(1) + ' s'
}

export function End({ stats, onHome, onNextExercise, onChangeSettings, onReplay, onBackToCatalog }: EndProps) {
  const grade = computeGrade(stats.successPercent)
  // recordPracticeDay() already ran when this session's Practice screen
  // mounted, so today already counts here -- no separate call needed.
  const streak = getStreakStats()

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="text-3xl font-semibold text-gray-900">Session complete</h1>

      <dl className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <dt className="text-xs uppercase text-gray-500">Grade</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{grade}</dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <dt className="text-xs uppercase text-gray-500">Time</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{formatDuration(stats.durationMs)}</dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <dt className="text-xs uppercase text-gray-500">Errors</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{stats.errorCount}</dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <dt className="text-xs uppercase text-gray-500">Success</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{stats.successPercent}%</dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <dt className="text-xs uppercase text-gray-500">Best combo</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{stats.maxCombo}</dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <dt className="text-xs uppercase text-gray-500">Streak</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{streak.currentStreak}</dd>
        </div>
      </dl>

      {stats.exercise && (
        <section className="w-full rounded-lg border border-gray-200 bg-white p-4 text-left">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-medium text-gray-900">Exercise stats</h2>
            <span className="text-xs text-gray-500">{stats.exercise.responseCount} responses</span>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <dt className="text-xs uppercase text-gray-500">Average</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{formatResponse(stats.exercise.averageResponseMs)}</dd>
            </div>
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <dt className="text-xs uppercase text-gray-500">Median</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{formatResponse(stats.exercise.medianResponseMs)}</dd>
            </div>
            <div className="rounded-md bg-gray-50 px-3 py-2">
              <dt className="text-xs uppercase text-gray-500">Slowest</dt>
              <dd className="mt-1 text-lg font-semibold text-gray-900">{formatResponse(stats.exercise.slowestResponseMs)}</dd>
            </div>
          </dl>

          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <h3 className="font-medium text-gray-900">Missed expected</h3>
              <p className="mt-1 text-gray-600">
                {stats.exercise.missedNotes.length > 0
                  ? stats.exercise.missedNotes.map((item) => item.note + ' x' + item.count).join(', ')
                  : 'No errors'}
              </p>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Wrong played</h3>
              <p className="mt-1 text-gray-600">
                {stats.exercise.wrongNotes.length > 0
                  ? stats.exercise.wrongNotes.map((item) => item.note + ' x' + item.count).join(', ')
                  : 'No errors'}
              </p>
            </div>
            <div>
              <h3 className="font-medium text-gray-900">Confusions</h3>
              <p className="mt-1 text-gray-600">
                {stats.exercise.confusions.length > 0
                  ? stats.exercise.confusions
                      .map((item) => item.expected + ' -> ' + item.played + ' x' + item.count)
                      .join(', ')
                  : 'No errors'}
              </p>
            </div>
          </div>
        </section>
      )}

      <p className="text-sm text-gray-500">
        Longest streak: {streak.longestStreak} {streak.longestStreak === 1 ? 'day' : 'days'} -- {streak.totalDaysPracticed}{' '}
        {streak.totalDaysPracticed === 1 ? 'day' : 'days'} practiced total
      </p>

      <div className="flex flex-wrap justify-center gap-3">
        {onNextExercise && (
          <button
            type="button"
            onClick={onNextExercise}
            className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Next exercise
          </button>
        )}
        {onChangeSettings && (
          <button
            type="button"
            onClick={onChangeSettings}
            className="rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Change settings
          </button>
        )}
        {onReplay && (
          <button
            type="button"
            onClick={onReplay}
            className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Practice again
          </button>
        )}
        {onBackToCatalog && (
          <button
            type="button"
            onClick={onBackToCatalog}
            className="rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Back to catalog
          </button>
        )}
        <button
          type="button"
          onClick={onHome}
          className={
            onNextExercise || onReplay
              ? 'rounded-md border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50'
              : 'rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700'
          }
        >
          Home
        </button>
      </div>
    </div>
  )
}
