import type { StreakStats } from '../engine/streak'

interface StreakBadgesProps {
  streak: StreakStats
  className?: string
}

interface Badge {
  label: string
  tone: string
}

/**
 * The practice streak as pastel pills, in the same register as ScoreHud's stat
 * tiles. Shared by Home and ScoreLibrary, which both used to render their own
 * plain-gray copy of this line.
 *
 * Renders nothing at all until there is a practice day to show, so a first-time
 * screen stays clean instead of announcing three zeros.
 */
export function StreakBadges({ streak, className }: StreakBadgesProps) {
  if (streak.totalDaysPracticed === 0) {
    return null
  }

  const days = (count: number) => `${count} day${count === 1 ? '' : 's'}`
  const badges: Badge[] = [
    { label: `${days(streak.currentStreak)} streak`, tone: 'bg-orange-100 text-orange-700' },
    { label: `Longest: ${days(streak.longestStreak)}`, tone: 'bg-purple-100 text-purple-700' },
    { label: `${days(streak.totalDaysPracticed)} practiced`, tone: 'bg-sky-100 text-sky-700' },
  ]

  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs font-medium ${className ?? ''}`}>
      {badges.map((badge) => (
        <span key={badge.label} className={`rounded-full px-2.5 py-1 ${badge.tone}`}>
          {badge.label}
        </span>
      ))}
    </div>
  )
}
