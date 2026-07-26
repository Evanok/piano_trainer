const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11]

const CORRECT_COLOR = '#22c55e'
const NEUTRAL_COLOR = '#eab308'
const WRONG_COLOR = '#ef4444'

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
}

export function VirtualKeyboard({
  lowestPitch,
  highestPitch,
  expectedPitches,
  heldPitches,
  wrongPitches = [],
}: VirtualKeyboardProps) {
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
  const whiteKeyWidth = 100 / whiteKeys.length

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

  const blackKeyLeft = (pitch: number): number => {
    let precedingWhite = pitch - 1
    while (!isWhiteKey(precedingWhite)) {
      precedingWhite -= 1
    }
    const index = whiteKeys.indexOf(precedingWhite)
    return (index + 1) * whiteKeyWidth - whiteKeyWidth * 0.3
  }

  return (
    <div className="relative h-28 w-full select-none rounded-md border border-gray-300 bg-white">
      {whiteKeys.map((pitch) => (
        <div
          key={pitch}
          className="absolute top-0 h-full border-r border-gray-300 last:border-r-0"
          style={{
            left: `${whiteKeys.indexOf(pitch) * whiteKeyWidth}%`,
            width: `${whiteKeyWidth}%`,
            backgroundColor: colorFor(pitch, '#ffffff'),
          }}
        />
      ))}
      {blackKeys.map((pitch) => (
        <div
          key={pitch}
          className="absolute top-0 z-10 h-3/5 rounded-b-sm"
          style={{
            left: `${blackKeyLeft(pitch)}%`,
            width: `${whiteKeyWidth * 0.6}%`,
            backgroundColor: colorFor(pitch, '#111827'),
          }}
        />
      ))}
    </div>
  )
}
