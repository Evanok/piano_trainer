import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NoteHand } from '../types/score'

const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11]

/** Below this, a key becomes too thin to read reliably on a phone screen --
 * a wide left/right-hand spread would otherwise squeeze every key down to
 * fit the full range into 100% width, making the far note's highlight an
 * invisible sliver. Past this width the keyboard scrolls instead of
 * shrinking further. */
const MIN_WHITE_KEY_WIDTH_PX = 28

const CORRECT_COLOR = '#22c55e'
const NEUTRAL_COLOR = '#eab308'
const WRONG_COLOR = '#ef4444'

/** The hand a key belongs to is a SECOND visual channel, deliberately not a
 * replacement for the yellow/green/red state colours above: a key still has to
 * read as expected/held/wrong first. It is drawn as a bar along the bottom of
 * the key, so it survives every state colour and works on black keys too (both
 * hues are dark enough to sit on white and light enough to sit on near-black,
 * with a white hairline separating the bar from the key itself). */
const RIGHT_HAND_COLOR = '#2563eb'
const LEFT_HAND_COLOR = '#9333ea'

/** Below this, an R/L letter inside a bar segment is an unreadable smudge, so
 * the segment keeps its colour and drops the letter -- the case for black keys
 * (0.6 of a white key) and for a key both hands play (half a key each). */
const HAND_LABEL_MIN_WIDTH_PX = 14

function isWhiteKey(pitch: number): boolean {
  return WHITE_OFFSETS.includes(((pitch % 12) + 12) % 12)
}

interface VirtualKeyboardProps {
  lowestPitch: number
  highestPitch: number
  expectedPitches: number[]
  heldPitches: number[]
  /** Every wrong note played since the last decay, if any -- shown even
   * though none of them are expected notes, so the player can see how far
   * off each attempt was and correct (e.g. an octave slip), not just that
   * they were wrong. All of them clear together when the decay timer fires. */
  wrongPitches?: number[]
  /** The expected pitches the right/left hand is written to play, so a
   * two-hand passage reads as two things to do rather than one undifferentiated
   * set of highlighted keys. Both are empty whenever the score has no
   * unambiguous pair of hands (see selectHandStaves), and the whole channel
   * then simply does not render. A pitch written on both staves legitimately
   * appears in both lists and gets a split bar. */
  rightHandPitches?: number[]
  leftHandPitches?: number[]
}

export function VirtualKeyboard({
  lowestPitch,
  highestPitch,
  expectedPitches,
  heldPitches,
  wrongPitches = [],
  rightHandPitches = [],
  leftHandPitches = [],
}: VirtualKeyboardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const keyRefs = useRef(new Map<number, HTMLDivElement>())
  const [containerWidthPx, setContainerWidthPx] = useState(0)

  // A wrong note might fall outside the piece's usual range (e.g. an octave
  // slip) -- widen the rendered range so it's still visible.
  const low = Math.min(lowestPitch, ...wrongPitches)
  const high = Math.max(highestPitch, ...wrongPitches)

  const whiteKeys: number[] = []
  const blackKeys: number[] = []
  for (let pitch = low; pitch <= high; pitch += 1) {
    if (isWhiteKey(pitch)) {
      whiteKeys.push(pitch)
    } else {
      blackKeys.push(pitch)
    }
  }

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      setContainerWidthPx(entries[0].contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const fittedWidth = containerWidthPx / Math.max(whiteKeys.length, 1)
  const whiteKeyWidthPx = containerWidthPx > 0 ? Math.max(MIN_WHITE_KEY_WIDTH_PX, fittedWidth) : MIN_WHITE_KEY_WIDTH_PX
  const contentWidthPx = whiteKeyWidthPx * whiteKeys.length

  const colorFor = (pitch: number, defaultColor: string): string => {
    if (wrongPitches.includes(pitch)) {
      return WRONG_COLOR
    }
    if (heldPitches.includes(pitch)) {
      return CORRECT_COLOR
    }
    if (expectedPitches.includes(pitch)) {
      return NEUTRAL_COLOR
    }
    return defaultColor
  }

  const handsFor = (pitch: number): NoteHand[] => {
    const hands: NoteHand[] = []
    if (rightHandPitches.includes(pitch)) {
      hands.push('right')
    }
    if (leftHandPitches.includes(pitch)) {
      hands.push('left')
    }
    return hands
  }

  const renderHandBar = (pitch: number, keyWidthPx: number, roundedClass: string) => {
    const hands = handsFor(pitch)
    if (hands.length === 0) {
      return null
    }
    const segmentWidthPx = keyWidthPx / hands.length
    return (
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex h-3 overflow-hidden border-t border-white ${roundedClass}`}>
        {hands.map((hand) => (
          <div
            key={hand}
            className="flex flex-1 items-center justify-center text-[8px] font-bold leading-none text-white"
            style={{ backgroundColor: hand === 'right' ? RIGHT_HAND_COLOR : LEFT_HAND_COLOR }}
          >
            {segmentWidthPx >= HAND_LABEL_MIN_WIDTH_PX ? (hand === 'right' ? 'R' : 'L') : null}
          </div>
        ))}
      </div>
    )
  }

  const blackKeyLeftPx = (pitch: number): number => {
    let precedingWhite = pitch - 1
    while (precedingWhite >= low && !isWhiteKey(precedingWhite)) {
      precedingWhite -= 1
    }
    const index = whiteKeys.indexOf(precedingWhite)
    if (index === -1) {
      return 0
    }
    return (index + 1) * whiteKeyWidthPx - whiteKeyWidthPx * 0.3
  }

  const setKeyRef = (pitch: number) => (el: HTMLDivElement | null) => {
    if (el) {
      keyRefs.current.set(pitch, el)
    } else {
      keyRefs.current.delete(pitch)
    }
  }

  // Keep whichever keys are actually relevant right now scrolled into view --
  // a wide hand spread can make the full range wider than the screen, so the
  // keyboard has to follow the current chord rather than staying put.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const active = [...expectedPitches, ...heldPitches, ...wrongPitches]
    const elements = active.map((pitch) => keyRefs.current.get(pitch)).filter((el): el is HTMLDivElement => el != null)
    if (elements.length === 0) return
    const spanLeft = Math.min(...elements.map((el) => el.offsetLeft))
    const spanRight = Math.max(...elements.map((el) => el.offsetLeft + el.offsetWidth))
    const spanCenter = (spanLeft + spanRight) / 2
    container.scrollTo({ left: Math.max(0, spanCenter - container.clientWidth / 2) })
  }, [expectedPitches, heldPitches, wrongPitches])

  return (
    <div ref={scrollRef} className="relative h-28 w-full select-none overflow-x-auto rounded-md border border-gray-300 bg-white">
      <div className="relative h-full" style={{ width: `${contentWidthPx}px` }}>
        {whiteKeys.map((pitch, index) => (
          <div
            key={pitch}
            ref={setKeyRef(pitch)}
            className="absolute top-0 h-full border-r border-gray-300 last:border-r-0"
            style={{
              left: `${index * whiteKeyWidthPx}px`,
              width: `${whiteKeyWidthPx}px`,
              backgroundColor: colorFor(pitch, '#ffffff'),
            }}
          >
            {renderHandBar(pitch, whiteKeyWidthPx, '')}
          </div>
        ))}
        {blackKeys.map((pitch) => (
          <div
            key={pitch}
            ref={setKeyRef(pitch)}
            className="absolute top-0 z-10 h-3/5 rounded-b-sm"
            style={{
              left: `${blackKeyLeftPx(pitch)}px`,
              width: `${whiteKeyWidthPx * 0.6}px`,
              backgroundColor: colorFor(pitch, '#111827'),
            }}
          >
            {renderHandBar(pitch, whiteKeyWidthPx * 0.6, 'rounded-b-sm')}
          </div>
        ))}
      </div>
    </div>
  )
}
