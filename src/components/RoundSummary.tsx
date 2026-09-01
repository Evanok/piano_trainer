/**
 * The end-of-round overlay both screen drills show, over the question card:
 * a letter grade, the first-try accuracy behind it, and the two ways out.
 */
import { computeGrade } from '../engine/grade'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../theme'

interface RoundSummaryProps {
  successPercent: number
  errorCount: number
  total: number
  /** What the round counted, for the sentence under the grade. */
  unit?: string
  onReplay: () => void
  onBack: () => void
}

export function RoundSummary({
  successPercent,
  errorCount,
  total,
  unit = 'notes',
  onReplay,
  onBack,
}: RoundSummaryProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/95 p-6 text-center">
      <div className="text-6xl font-bold text-amber-600">{computeGrade(successPercent)}</div>
      <p className="text-sm text-gray-600">
        {successPercent}% first-try over {total} {unit}, {errorCount} wrong answer{errorCount === 1 ? '' : 's'}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onReplay} className={PRIMARY_BUTTON}>
          New round
        </button>
        <button type="button" onClick={onBack} className={SECONDARY_BUTTON}>
          Back
        </button>
      </div>
    </div>
  )
}
