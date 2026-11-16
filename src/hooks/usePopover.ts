import { useEffect, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'

// The practice score's wrapper turns a held press into a cursor jump on
// mobile; a press inside a header panel must not reach it.
export const stopTouch = (event: ReactTouchEvent) => event.stopPropagation()

/**
 * A header button's dropdown panel: open state, and closing on a press outside
 * `rootRef` or on Escape. Shared by the metronome and auto-scroll panels.
 */
export function usePopover() {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return { isOpen, setIsOpen, rootRef }
}
