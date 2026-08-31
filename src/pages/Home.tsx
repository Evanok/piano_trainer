import { useState } from 'react'
import { ChartIcon, LibraryIcon, NotesIcon } from '../components/icons'
import { GuestLinkShare } from '../components/GuestLinkShare'
import { StreakBadges } from '../components/StreakBadges'
import { getStreakStats } from '../engine/streak'
import { useIsMobile } from '../hooks/useIsMobile'
import { PAGE_BACKGROUND } from '../theme'

interface HomeProps {
  onStartExercise: () => void
  onPracticeScore: () => void
  onViewStats: () => void
  /** This device came in through a share link: say so, since half the controls
   *  it would normally have are hidden. */
  isGuestSession: boolean
  /** The token behind the owner's share link, null for a guest and whenever the
   *  server has no guest password configured. */
  guestToken: string | null
}

interface Tile {
  title: string
  subtitle: string
  action: string
  Icon: (props: { className?: string }) => React.JSX.Element
  onClick: () => void
  /** One pastel family per intent, in the same register as ScoreHud's tiles. */
  cardColor: string
  badgeColor: string
  titleColor: string
  actionColor: string
}

export function Home({ onStartExercise, onPracticeScore, onViewStats, isGuestSession, guestToken }: HomeProps) {
  const isMobile = useIsMobile()
  const [streak] = useState(() => getStreakStats())

  const tiles: Tile[] = [
    {
      title: 'Exercise',
      subtitle: 'Drills and technique',
      action: 'Start',
      Icon: NotesIcon,
      onClick: onStartExercise,
      cardColor: 'border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100',
      badgeColor: 'bg-amber-100 text-amber-700',
      titleColor: 'text-amber-900',
      actionColor: 'text-amber-700',
    },
    {
      title: 'Practice a score',
      subtitle: 'Upload or open catalog',
      action: 'Open',
      Icon: LibraryIcon,
      onClick: onPracticeScore,
      cardColor: 'border-indigo-200 bg-indigo-50 hover:border-indigo-300 hover:bg-indigo-100',
      badgeColor: 'bg-indigo-100 text-indigo-700',
      titleColor: 'text-indigo-900',
      actionColor: 'text-indigo-700',
    },
    {
      title: 'Stats',
      subtitle: 'Progress and weak spots',
      action: 'View',
      Icon: ChartIcon,
      onClick: onViewStats,
      cardColor: 'border-emerald-200 bg-emerald-50 hover:border-emerald-300 hover:bg-emerald-100',
      badgeColor: 'bg-emerald-100 text-emerald-700',
      titleColor: 'text-emerald-900',
      actionColor: 'text-emerald-700',
    },
  ]

  return (
    <div
      className={
        isMobile
          ? `flex h-screen w-full flex-col overflow-hidden px-5 py-4 ${PAGE_BACKGROUND}`
          : `min-h-screen ${PAGE_BACKGROUND}`
      }
    >
      <div
        className={
          isMobile
            ? 'flex min-h-0 flex-1 flex-col'
            : 'mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-10 px-8 py-14'
        }
      >
        <header className={isMobile ? 'shrink-0 text-center' : 'text-center'}>
          <div className="flex items-baseline justify-center gap-2">
            <h1 className={isMobile ? 'text-2xl font-semibold text-gray-900' : 'text-4xl font-semibold text-gray-900'}>
              Piano Trainer
            </h1>
            <span className="text-xs font-normal text-gray-400">{import.meta.env.VITE_APP_VERSION}</span>
          </div>
          <StreakBadges streak={streak} className="mt-3 justify-center" />
          {isGuestSession && (
            <p className="mt-3 inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              Guest access, read only
            </p>
          )}
          {!isGuestSession && guestToken && (
            <div className="mt-3 flex justify-center">
              <GuestLinkShare token={guestToken} />
            </div>
          )}
        </header>

        <main className={isMobile ? 'grid min-h-0 flex-1 grid-cols-3 gap-3 pt-4' : 'grid grid-cols-3 gap-5'}>
          {tiles.map((tile) => (
            <button
              key={tile.title}
              type="button"
              onClick={tile.onClick}
              className={`flex min-h-0 flex-col justify-between rounded-xl border p-5 text-left shadow-sm transition-colors ${
                isMobile ? '' : 'min-h-56'
              } ${tile.cardColor}`}
            >
              <span>
                <span className={`inline-flex rounded-lg p-2 ${tile.badgeColor}`}>
                  <tile.Icon className={isMobile ? 'h-5 w-5' : 'h-6 w-6'} />
                </span>
                <span
                  className={`${isMobile ? 'mt-3 block text-lg font-semibold' : 'mt-4 block text-2xl font-semibold'} ${tile.titleColor}`}
                >
                  {tile.title}
                </span>
                <span className="mt-2 block text-sm leading-5 text-gray-600">{tile.subtitle}</span>
              </span>
              <span className={`mt-4 text-sm font-semibold ${tile.actionColor}`}>{tile.action}</span>
            </button>
          ))}
        </main>
      </div>
    </div>
  )
}
