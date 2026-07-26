interface ScoreHudProps {
  currentCombo: number
  bestCombo: number
  correctNoteCount: number
  errorCount: number
}

interface Tile {
  label: string
  value: number
  border: string
  bg: string
  text: string
}

// A distinct, colorful stat strip -- deliberately separate from the small
// gray utility-controls row below it (zoom, measure jump, layout toggles),
// so the score itself doesn't get buried among unrelated controls.
export function ScoreHud({ currentCombo, bestCombo, correctNoteCount, errorCount }: ScoreHudProps) {
  const tiles: Tile[] = [
    { label: 'Combo', value: currentCombo, border: 'border-orange-200', bg: 'bg-orange-50', text: 'text-orange-700' },
    {
      label: 'Best combo',
      value: bestCombo,
      border: 'border-purple-200',
      bg: 'bg-purple-50',
      text: 'text-purple-700',
    },
    {
      label: 'Correct notes',
      value: correctNoteCount,
      border: 'border-green-200',
      bg: 'bg-green-50',
      text: 'text-green-700',
    },
    { label: 'Errors', value: errorCount, border: 'border-red-200', bg: 'bg-red-50', text: 'text-red-700' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className={`rounded-lg border ${tile.border} ${tile.bg} px-4 py-3 text-center`}>
          <div className={`text-xs font-semibold uppercase tracking-wide ${tile.text}`}>{tile.label}</div>
          <div className={`mt-1 text-3xl font-bold ${tile.text}`}>{tile.value}</div>
        </div>
      ))}
    </div>
  )
}
