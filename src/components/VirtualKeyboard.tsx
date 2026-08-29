import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteHand } from '../types/score'

const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11]

/**
 * The keyboard is ALWAYS the same 88 keys of a real piano (A0 to C8), whatever
 * the piece spans. It used to render exactly the piece's own range, fitted to
 * 100% of the container width, which meant the scale changed from piece to
 * piece AND mid-practice (an out-of-range wrong note widened the range, so
 * every key silently resized and shifted under the player's eyes). With a fixed
 * instrument and a width that depends only on the container, a position on
 * screen keeps meaning the same pitch, which is what makes an octave jump
 * visible as movement instead of an identical-looking redraw.
 *
 * A note outside a real piano's range is therefore not drawn at all. Only a
 * controller reporting outside 21..108 can produce one, and Practice still
 * names the wrong note in text.
 */
const KEYBOARD_LOWEST_PITCH = 21
const KEYBOARD_HIGHEST_PITCH = 108

const MIDDLE_C = 60

/** How many white keys the container should show at once: three octaves, which
 * is what it takes for an ordinary two-hand chord plus its melody note to fit
 * on screen at once without the keyboard having to scroll on every event.
 * Clamped: below the minimum a key is too thin to read a highlight on, above
 * the maximum the keyboard turns into a handful of giant keys on a wide
 * desktop. Everything outside the resulting window is reached by scrolling. */
const TARGET_VISIBLE_WHITE_KEYS = 21
const MIN_WHITE_KEY_WIDTH_PX = 26
const MAX_WHITE_KEY_WIDTH_PX = 48

/** How much clear space the active keys need on both sides before the view is
 * considered to already show them. Below that the keyboard re-centres. */
const SCROLL_COMFORT_WHITE_KEYS = 1

/**
 * Every key is painted as a top-to-bottom pair rather than one flat fill: a
 * real key catches the light along its length, and a row of flat rectangles is
 * exactly what made this component look unfinished next to the rest of the app.
 * The state hues are the same yellow/green/red the sheet uses -- only the
 * shading is new, so nothing about what a colour MEANS changed here.
 */
const KEY_FACES = {
  expected: ['#fde047', '#eab308'],
  held: ['#4ade80', '#16a34a'],
  wrong: ['#fca5a5', '#dc2626'],
  white: ['#ffffff', '#f0f3f7'],
  /** White keys outside the piece's own lowest/highest note, tinted just enough
   * to show which stretch of the instrument the piece actually lives on. The
   * black keys deliberately keep one single face: two shades of near-black read
   * as a rendering fault rather than as information. */
  whiteOutside: ['#eef1f6', '#dde3ea'],
  black: ['#3b4455', '#0c1119'],
} as const

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

function isC(pitch: number): boolean {
  return ((pitch % 12) + 12) % 12 === 0
}

/** C4 for middle C, matching how every other note name in the app is spelled. */
function octaveLabel(pitch: number): string {
  return `C${Math.floor(pitch / 12) - 1}`
}

interface VirtualKeyboardProps {
  /** The piece's own range. It no longer decides the keyboard's size (see
   * KEYBOARD_LOWEST_PITCH): it only greys out the keys the piece never uses
   * and says where to scroll to when a new piece is loaded. */
  lowestPitch: number
  highestPitch: number
  expectedPitches: number[]
  heldPitches: number[]
  /** Every wrong note played since the last decay, if any -- coloured red
   * where it falls, so the player can see how far off the attempt was (e.g. an
   * octave slip), not just that it was wrong. It never moves the view though:
   * see the follow effect below. All of them clear together when the decay
   * timer fires. */
  wrongPitches?: number[]
  /** The expected pitches the right/left hand is written to play, so a
   * two-hand passage reads as two things to do rather than one undifferentiated
   * set of highlighted keys. Both are empty whenever the score has no
   * unambiguous pair of hands (see selectHandStaves), and the whole channel
   * then simply does not render. A pitch written on both staves legitimately
   * appears in both lists and gets a split bar. */
  rightHandPitches?: number[]
  leftHandPitches?: number[]
  /**
   * Makes the keys answer taps, for the reading quiz's "tap the key" mode. Left
   * out during practice, where the keyboard is a mirror of what the MIDI
   * keyboard is doing and must not become a way to play notes with a finger.
   */
  onKeyPress?: (pitch: number) => void
}

export function VirtualKeyboard({
  lowestPitch,
  highestPitch,
  expectedPitches,
  heldPitches,
  wrongPitches = [],
  rightHandPitches = [],
  leftHandPitches = [],
  onKeyPress,
}: VirtualKeyboardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const keyRefs = useRef(new Map<number, HTMLDivElement>())
  const [containerWidthPx, setContainerWidthPx] = useState(0)

  const { whiteKeys, blackKeys, whiteIndexByPitch } = useMemo(() => {
    const white: number[] = []
    const black: number[] = []
    const indexByPitch = new Map<number, number>()
    for (let pitch = KEYBOARD_LOWEST_PITCH; pitch <= KEYBOARD_HIGHEST_PITCH; pitch += 1) {
      if (isWhiteKey(pitch)) {
        indexByPitch.set(pitch, white.length)
        white.push(pitch)
      } else {
        black.push(pitch)
      }
    }
    return { whiteKeys: white, blackKeys: black, whiteIndexByPitch: indexByPitch }
  }, [])

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      setContainerWidthPx(entries[0].contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const whiteKeyWidthPx =
    containerWidthPx > 0
      ? Math.min(MAX_WHITE_KEY_WIDTH_PX, Math.max(MIN_WHITE_KEY_WIDTH_PX, containerWidthPx / TARGET_VISIBLE_WHITE_KEYS))
      : MIN_WHITE_KEY_WIDTH_PX
  const contentWidthPx = whiteKeyWidthPx * whiteKeys.length

  const faceFor = (pitch: number, isBlack: boolean): readonly [string, string] => {
    if (wrongPitches.includes(pitch)) {
      return KEY_FACES.wrong
    }
    if (heldPitches.includes(pitch)) {
      return KEY_FACES.held
    }
    if (expectedPitches.includes(pitch)) {
      return KEY_FACES.expected
    }
    if (isBlack) {
      return KEY_FACES.black
    }
    return pitch >= lowestPitch && pitch <= highestPitch ? KEY_FACES.white : KEY_FACES.whiteOutside
  }

  // A held key is drawn pressed (shadow falling INTO the key from the top)
  // rather than resting, which is the one bit of feedback a real keyboard
  // gives that a colour change alone does not.
  const keyStyle = (pitch: number, isBlack: boolean) => {
    const [top, bottom] = faceFor(pitch, isBlack)
    const pressed = heldPitches.includes(pitch)
    const resting = isBlack
      ? 'inset 0 1px 0 rgba(255,255,255,0.28), 0 3px 4px rgba(0,0,0,0.45)'
      : 'inset 0 -7px 7px -7px rgba(0,0,0,0.35)'
    return {
      background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`,
      boxShadow: pressed ? 'inset 0 5px 7px -3px rgba(0,0,0,0.45)' : resting,
    }
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

  // The one fixed reference point on an otherwise perfectly repeating pattern
  // of keys: middle C is a filled badge, every other C just names its octave.
  // Without this, the keyboard scrolled to a different octave looks exactly
  // like the one it left.
  const renderOctaveLabel = (pitch: number) => {
    if (!isC(pitch)) {
      return null
    }
    if (pitch === MIDDLE_C) {
      return (
        <span className="pointer-events-none absolute inset-x-0 bottom-4 mx-auto w-fit rounded bg-indigo-600 px-1 py-px text-[9px] font-bold leading-none text-white shadow-sm">
          {octaveLabel(pitch)}
        </span>
      )
    }
    return (
      <span className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[9px] font-semibold leading-none text-slate-600">
        {octaveLabel(pitch)}
      </span>
    )
  }

  const blackKeyLeftPx = (pitch: number): number => {
    let precedingWhite = pitch - 1
    while (precedingWhite >= KEYBOARD_LOWEST_PITCH && !isWhiteKey(precedingWhite)) {
      precedingWhite -= 1
    }
    const index = whiteIndexByPitch.get(precedingWhite)
    if (index === undefined) {
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

  const scrollToSpan = (spanLeft: number, spanRight: number, behavior: ScrollBehavior = 'auto') => {
    const container = scrollRef.current
    if (!container) return
    const spanCenter = (spanLeft + spanRight) / 2
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
    container.scrollTo({ left: Math.min(maxScroll, Math.max(0, spanCenter - container.clientWidth / 2)), behavior })
  }

  const spanOf = (pitches: number[]): { left: number; right: number } | null => {
    const elements = pitches.map((pitch) => keyRefs.current.get(pitch)).filter((el): el is HTMLDivElement => el != null)
    if (elements.length === 0) {
      return null
    }
    return {
      left: Math.min(...elements.map((el) => el.offsetLeft)),
      right: Math.max(...elements.map((el) => el.offsetLeft + el.offsetWidth)),
    }
  }

  // Point the window at the piece when the piece (or the hand being practised)
  // changes: the whole instrument is rendered now, so without this a piece
  // written low would open on the wrong end of the keyboard.
  useEffect(() => {
    const span = spanOf([lowestPitch, highestPitch])
    if (span) {
      scrollToSpan(span.left, span.right)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowestPitch, highestPitch, whiteKeyWidthPx])

  // Follow the current chord only when it is NOT already comfortably visible.
  // Re-centring on every event was what made an octave leap invisible: the
  // keyboard slid under the highlight so the highlight itself never moved.
  // Leaving the view alone while the notes stay on screen means the highlight
  // travels across a stationary instrument, and a jump that does need a scroll
  // reads as one.
  //
  // WRONG notes are deliberately not part of what the view follows. A slip two
  // octaves off would otherwise drag the keyboard away from the notes actually
  // being played, exactly when the player needs to see them. Such a note is
  // still coloured red where it is; if that is off screen, it stays off
  // screen -- the view belongs to what has to be played, not to the mistake.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const span = spanOf([...expectedPitches, ...heldPitches])
    if (!span) return
    const comfort = whiteKeyWidthPx * SCROLL_COMFORT_WHITE_KEYS
    const viewLeft = container.scrollLeft
    const viewRight = viewLeft + container.clientWidth
    if (span.left >= viewLeft + comfort && span.right <= viewRight - comfort) {
      return
    }
    // Animated, unlike the load-time positioning above: when the keyboard does
    // have to move, seeing it slide is itself the cue that the hand has to
    // travel, which an instant redraw never gives.
    scrollToSpan(span.left, span.right, 'smooth')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedPitches, heldPitches, whiteKeyWidthPx])

  return (
    <div
      ref={scrollRef}
      className="relative h-28 w-full select-none overflow-x-auto rounded-lg border border-slate-500 bg-slate-300 shadow-md"
    >
      <div className="relative h-full" style={{ width: `${contentWidthPx}px` }}>
        {whiteKeys.map((pitch, index) => (
          <div
            key={pitch}
            ref={setKeyRef(pitch)}
            onClick={onKeyPress ? () => onKeyPress(pitch) : undefined}
            className={`absolute top-0 h-full rounded-b-md border-r border-gray-300${onKeyPress ? ' cursor-pointer' : ''}`}
            style={{
              left: `${index * whiteKeyWidthPx}px`,
              width: `${whiteKeyWidthPx}px`,
              ...keyStyle(pitch, false),
              // Every octave gets a visible edge, so the eye can count octaves
              // instead of reading a uniform row of identical keys.
              borderLeft: isC(pitch) ? '1px solid #94a3b8' : undefined,
            }}
          >
            {renderOctaveLabel(pitch)}
            {renderHandBar(pitch, whiteKeyWidthPx, '')}
          </div>
        ))}
        {blackKeys.map((pitch) => (
          <div
            key={pitch}
            ref={setKeyRef(pitch)}
            onClick={onKeyPress ? () => onKeyPress(pitch) : undefined}
            className={`absolute top-0 z-10 h-3/5 rounded-b${onKeyPress ? ' cursor-pointer' : ''}`}
            style={{
              left: `${blackKeyLeftPx(pitch)}px`,
              width: `${whiteKeyWidthPx * 0.6}px`,
              ...keyStyle(pitch, true),
            }}
          >
            {renderHandBar(pitch, whiteKeyWidthPx * 0.6, 'rounded-b-sm')}
          </div>
        ))}
        {/* The dark fascia a real piano has above its keys: it reads as an
            instrument rather than a row of rectangles, and it hides the seam
            where the black keys start. Deliberately not the strip of red felt
            a real piano also has there: red is the wrong-note colour
            everywhere else in the app, and it has no business appearing
            permanently on the keyboard. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-2 bg-gradient-to-b from-slate-900 to-slate-700" />
      </div>
    </div>
  )
}
