import type { TouchEvent as ReactTouchEvent } from 'react'

/** What a sudden-death run ended on, frozen until the player asks to retry. */
export interface SuddenDeathMiss {
  measure: number
  /** Note names the score asked for at that point, e.g. "C6 + F2". */
  expected: string
  played: string
  /** Clean events in a row before the miss. */
  run: number
}

interface SuddenDeathCardProps {
  miss: SuddenDeathMiss
  best: number
  onRetry: () => void
  compact?: boolean
}

// The touch handlers of the score wrapper turn a held press into a cursor
// jump, so a press that starts on this card must not reach them.
const stopTouch = (event: ReactTouchEvent) => event.stopPropagation()

/**
 * Shown over the bottom-right corner of the score when a sudden-death run
 * ends. Practice stays frozen on the missed event while it is up, so the
 * expected note is still highlighted on the score and on the keyboard, next to
 * the wrong key in red: the point is to see what should have been played
 * before starting over, which an automatic jump back to the start never left
 * time for. Kept to a corner so it does not cover the cursor, which scroll
 * mode keeps near the left.
 */
export function SuddenDeathCard({ miss, best, onRetry, compact = false }: SuddenDeathCardProps) {
  return (
    <div
      className={`sudden-death-card absolute z-20 flex flex-col items-stretch rounded-xl bg-white/95 shadow-xl ring-2 ring-red-400 ${
        compact ? 'bottom-2 right-2 gap-1 px-3 py-2' : 'bottom-4 right-4 gap-2 px-5 py-4'
      }`}
      onTouchStart={stopTouch}
    >
      <div className={`font-combo leading-none text-red-500 ${compact ? 'text-xl' : 'text-3xl'}`}>Missed!</div>
      <div className={`text-gray-700 ${compact ? 'text-xs' : 'text-sm'}`}>
        Measure {miss.measure}: expected <span className="font-semibold text-gray-900">{miss.expected}</span>, played{' '}
        <span className="font-semibold text-red-600">{miss.played}</span>
      </div>
      <div className={`text-gray-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        Run {miss.run} · best {best}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className={`font-combo rounded-lg bg-red-500 tracking-wider text-white shadow hover:bg-red-600 active:scale-95 ${
          compact ? 'mt-1 px-3 pb-1 pt-1.5 text-base' : 'mt-1 px-4 pb-1.5 pt-2.5 text-xl'
        }`}
      >
        Retry
      </button>
      {!compact && <div className="text-center text-[11px] text-gray-400">or press Enter</div>}
    </div>
  )
}
