import type { SessionStats } from '../types/session'

interface EndProps {
  stats: SessionStats
  onRestart: () => void
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function End({ stats, onRestart }: EndProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="text-3xl font-semibold text-gray-900">Session complete</h1>

      <dl className="grid w-full grid-cols-3 gap-4">
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
      </dl>

      <button
        type="button"
        onClick={onRestart}
        className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        Back to home
      </button>
    </div>
  )
}
