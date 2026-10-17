import { DAILY_GOAL_CHOICES, type DailyGoalProgress } from '../engine/dailyGoal'

interface DailyGoalProps {
  progress: DailyGoalProgress
  onGoalChange: (minutes: number) => void
  className?: string
}

/**
 * Today's minutes against the daily goal, as one bar under the streak. The goal
 * is picked right here rather than in a settings screen, since this is the only
 * place it is ever looked at. Orange while under way and green once reached,
 * the same two hues the practice calendar uses for a short day and a real one.
 */
export function DailyGoal({ progress, onGoalChange, className = '' }: DailyGoalProps) {
  const minutes = progress.minutes < 1 && progress.minutes > 0 ? '<1' : Math.floor(progress.minutes).toString()
  return (
    <div className={`mx-auto w-full max-w-xs ${className}`}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`font-semibold ${progress.reached ? 'text-green-700' : 'text-orange-700'}`}>
          {progress.reached ? 'Daily goal reached ✓' : 'Today'}
        </span>
        <span className="text-gray-600">
          <span className="font-semibold text-gray-900">{minutes}</span>
          {' / '}
          <select
            aria-label="Daily goal"
            value={progress.goalMinutes}
            onChange={(event) => onGoalChange(Number(event.target.value))}
            className="cursor-pointer rounded bg-transparent font-semibold text-gray-900 underline decoration-dotted underline-offset-2 hover:bg-white/60"
          >
            {/* A stored goal no longer offered still has to show as itself. */}
            {(DAILY_GOAL_CHOICES.includes(progress.goalMinutes)
              ? DAILY_GOAL_CHOICES
              : [...DAILY_GOAL_CHOICES, progress.goalMinutes].sort((a, b) => a - b)
            ).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>{' '}
          min
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/70 ring-1 ring-gray-200">
        <div
          className={`h-full rounded-full transition-[width] ${progress.reached ? 'bg-green-500' : 'bg-orange-400'}`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  )
}
