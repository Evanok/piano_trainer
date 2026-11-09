/**
 * One row of answer buttons plus the number-row shortcut, for a keypad whose
 * choices are not note names: the interval drill's numbers and qualities.
 *
 * Same look as `NoteNameButtons` and `ChordQualityButtons` (a wrong answer
 * marked in rose, the right one revealed in emerald), and the same rule for the
 * digits: they answer the button AT THAT POSITION.
 */
import { useEffect } from 'react'

interface ChoiceButtonsProps<T extends string | number> {
  choices: T[]
  labelOf: (choice: T) => string
  /** Wrong answers given to the current step, all of them marked. */
  wrongChoices: T[]
  /** The right answer, shown once the step has been missed. */
  answer: T | null
  disabled: boolean
  onAnswer: (choice: T) => void
}

export function ChoiceButtons<T extends string | number>({
  choices,
  labelOf,
  wrongChoices,
  answer,
  disabled,
  onAnswer,
}: ChoiceButtonsProps<T>) {
  // Re-registered every render: onAnswer closes over the current question.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const index = Number(event.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < choices.length) {
        onAnswer(choices[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    // One row whatever the count, so no button wraps alone below the fold.
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}
    >
      {choices.map((choice) => {
        const isWrong = wrongChoices.includes(choice)
        const isAnswer = answer === choice
        return (
          <button
            key={choice}
            type="button"
            onClick={() => onAnswer(choice)}
            disabled={disabled}
            className={`rounded-lg border px-1 py-4 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 sm:text-base ${
              isWrong
                ? 'border-rose-300 bg-rose-100 text-rose-700'
                : isAnswer
                  ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                  : 'border-indigo-200 bg-white text-gray-800 hover:bg-indigo-50'
            }`}
          >
            {labelOf(choice)}
          </button>
        )
      })}
    </div>
  )
}
