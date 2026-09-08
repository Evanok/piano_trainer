/**
 * The answer buttons of the chord drill, and the number-row shortcut with them.
 *
 * The same shape as `NoteNameButtons`, and the same colours (a wrong answer
 * marked in rose, the right one revealed in emerald), so the two drills feel
 * like one app. Two differences, both deliberate:
 *
 * - The order comes from the round but is never shuffled. There is nothing to
 *   shuffle away: three qualities cannot be walked by counting buttons the way
 *   seven note names in scale order can, so an arrangement carries no shortcut.
 * - The label carries the degree once the answer is revealed, because the
 *   answer to "which chord is this" is not really "minor" -- it is "re minor,
 *   the ii of do major", and that is the table the drill exists to teach.
 */
import { useEffect } from 'react'
import { chordQualityLabel } from '../engine/chordQuiz'
import type { ChordQuality } from '../types/chord'

interface ChordQualityButtonsProps {
  /** The qualities in play, left to right. */
  qualities: ChordQuality[]
  /** Wrong answers given to the current question, all of them marked. */
  wrongQualities: ChordQuality[]
  /** The right answer, shown once the question has been missed. */
  answerQuality: ChordQuality | null
  disabled: boolean
  onAnswer: (quality: ChordQuality) => void
}

export function ChordQualityButtons({
  qualities,
  wrongQualities,
  answerQuality,
  disabled,
  onAnswer,
}: ChordQualityButtonsProps) {
  // Re-registered every render, like NoteNameButtons: onAnswer closes over the
  // current question, and a stale one would answer the question before it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < qualities.length) {
        onAnswer(qualities[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {qualities.map((quality) => {
        const isWrong = wrongQualities.includes(quality)
        const isAnswer = answerQuality === quality
        return (
          <button
            key={quality}
            type="button"
            onClick={() => onAnswer(quality)}
            disabled={disabled}
            className={`rounded-lg border py-4 text-base font-semibold shadow-sm transition-colors disabled:opacity-50 ${
              isWrong
                ? 'border-rose-300 bg-rose-100 text-rose-700'
                : isAnswer
                  ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                  : 'border-indigo-200 bg-white text-gray-800 hover:bg-indigo-50'
            }`}
          >
            {chordQualityLabel(quality)}
          </button>
        )
      })}
    </div>
  )
}
