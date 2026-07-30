import { useState } from 'react'
import { getStreakStats } from '../engine/streakStore'
import { useIsMobile } from '../hooks/useIsMobile'

interface HomeProps {
  onStartExercise: () => void
  onPracticeScore: () => void
}

export function Home({ onStartExercise, onPracticeScore }: HomeProps) {
  const isMobile = useIsMobile()
  const [streak] = useState(() => getStreakStats())

  return (
    <div
      className={
        isMobile
          ? 'flex h-screen w-full flex-col overflow-hidden bg-gray-100 px-5 py-4'
          : 'mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-8 py-14'
      }
    >
      <header className={isMobile ? 'shrink-0 text-center' : 'text-center'}>
        <h1 className={isMobile ? 'text-2xl font-semibold text-gray-900' : 'text-4xl font-semibold text-gray-900'}>
          Piano Trainer
        </h1>
        {streak.totalDaysPracticed > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-gray-600">
            <span>
              {streak.currentStreak} day{streak.currentStreak === 1 ? '' : 's'} streak
            </span>
            <span>
              Longest: {streak.longestStreak} day{streak.longestStreak === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </header>

      <main className={isMobile ? 'grid min-h-0 flex-1 grid-cols-2 gap-4 pt-4' : 'grid grid-cols-2 gap-5'}>
        <button
          type="button"
          onClick={onStartExercise}
          className="flex min-h-0 flex-col justify-between rounded-lg border border-gray-200 bg-white p-5 text-left hover:border-gray-300 hover:bg-gray-50"
        >
          <span>
            <span className={isMobile ? 'block text-xl font-semibold text-gray-900' : 'block text-2xl font-semibold text-gray-900'}>
              Exercise
            </span>
            <span className="mt-2 block text-sm leading-5 text-gray-600">Generated note drills</span>
          </span>
          <span className="mt-4 text-sm font-medium text-gray-900">Start</span>
        </button>

        <button
          type="button"
          onClick={onPracticeScore}
          className="flex min-h-0 flex-col justify-between rounded-lg border border-gray-200 bg-white p-5 text-left hover:border-gray-300 hover:bg-gray-50"
        >
          <span>
            <span className={isMobile ? 'block text-xl font-semibold text-gray-900' : 'block text-2xl font-semibold text-gray-900'}>
              Practice a score
            </span>
            <span className="mt-2 block text-sm leading-5 text-gray-600">Upload or open catalog</span>
          </span>
          <span className="mt-4 text-sm font-medium text-gray-900">Open</span>
        </button>
      </main>
    </div>
  )
}
