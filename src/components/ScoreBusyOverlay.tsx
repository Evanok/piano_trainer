/**
 * Shown over the score while OSMD lays it out again (loading, a mode or hand
 * switch, a section change). Those block the main thread for up to several
 * seconds on a phone, so nothing here may depend on JavaScript running: the
 * spinner and the fade-in are CSS animations the compositor drives on its own
 * (see `.score-busy-overlay` in index.css). Practice waits for this to be
 * painted before starting the work, see `runWhileBusy`.
 */
export function ScoreBusyOverlay({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="score-busy-overlay absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/70"
    >
      <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-md ring-1 ring-gray-200">
        <span className="score-busy-spinner block h-5 w-5 rounded-full border-2 border-indigo-200 border-t-indigo-600" />
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
    </div>
  )
}
