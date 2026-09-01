/**
 * The seven latin name buttons every screen drill answers with, plus the
 * number-row shortcut that goes with them.
 *
 * The order comes from the round, not from this component: both drills can
 * shuffle it so a note cannot be found by counting buttons, and the digits
 * therefore answer the button AT THAT POSITION rather than a fixed note. A
 * shortcut that always meant "1 = do" would hand the counting straight back.
 */
import { useEffect } from 'react'
import { latinNameOf } from '../engine/readingQuiz'

interface NoteNameButtonsProps {
  /** Steps (C..B) in the order they are drawn, left to right. */
  order: string[]
  /** Wrong answers given to the current question, all of them marked. */
  wrongSteps: string[]
  /** The right answer, shown once the question has been missed. */
  answerStep: string | null
  disabled: boolean
  onAnswer: (step: string) => void
}

export function NoteNameButtons({ order, wrongSteps, answerStep, disabled, onAnswer }: NoteNameButtonsProps) {
  // Deliberately re-registered every render: onAnswer closes over the current
  // question, and a stale one would answer the question before it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < order.length) {
        onAnswer(order[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {order.map((step) => {
        const isWrong = wrongSteps.includes(step)
        const isAnswer = answerStep === step
        return (
          <button
            key={step}
            type="button"
            onClick={() => onAnswer(step)}
            disabled={disabled}
            className={`rounded-lg border py-4 text-base font-semibold shadow-sm transition-colors disabled:opacity-50 ${
              isWrong
                ? 'border-rose-300 bg-rose-100 text-rose-700'
                : isAnswer
                  ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                  : 'border-indigo-200 bg-white text-gray-800 hover:bg-indigo-50'
            }`}
          >
            {latinNameOf(step)}
          </button>
        )
      })}
    </div>
  )
}
