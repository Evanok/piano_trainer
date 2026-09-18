/**
 * A small drawn staff carrying one chord, for the chord lesson.
 *
 * Hand-drawn SVG rather than OSMD, deliberately, and this is the one place in
 * the app where that is the right call: these are diagrams, not notation. They
 * carry labels, a highlighted root and a bracket marking an interval, none of
 * which a score renderer will draw; they must lay out identically next to each
 * other for comparison; and they are static, so none of the reasons
 * `ReadingStaff` exists (cropping, rapid-fire questions, engraving fidelity)
 * apply. There is also no clef, which is why no music font is needed: the
 * diagrams are about the *shape* of a stack, and each note is named underneath
 * in words instead.
 *
 * Positions are counted in staff steps with **0 = the bottom line**, one step
 * per line or space going up, which is the same diatonic counting the generator
 * uses. A third is 2 steps, a fourth is 3.
 */

const STEP_PX = 6
const BOTTOM_LINE_Y = 48
const NOTE_X = 78
const STAFF_LEFT = 12
const STAFF_RIGHT = 150

function yOf(position: number): number {
  return BOTTOM_LINE_Y - position * STEP_PX
}

export interface ChordDiagramNote {
  /** Staff step, 0 = bottom line. Negative goes below, and draws a ledger. */
  position: number
  /** The note's name, written under the staff beneath its notehead. */
  name: string
  /** '♯' or '♭' drawn before the notehead, when the note carries one. */
  accidental?: string
  /** Drawn filled and coloured: this is the chord's root. */
  isRoot?: boolean
}

interface ChordDiagramProps {
  title: string
  /** Bottom to top. */
  notes: ChordDiagramNote[]
  /**
   * Index of the LOWER note of the pair that makes the wide gap (the fourth),
   * bracketed and labelled. Left out for a root-position stack, which has none
   * of its own: its fourth falls outside the drawing, which is the whole point.
   */
  gapBelow?: number
  caption: string
}

export function ChordDiagram({ title, notes, gapBelow, caption }: ChordDiagramProps) {
  const top = Math.min(...notes.map((note) => yOf(note.position)))
  const bottom = Math.max(...notes.map((note) => yOf(note.position)))
  const viewTop = Math.min(top - 14, -6)
  const height = Math.max(bottom + 34, BOTTOM_LINE_Y + 34) - viewTop

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs font-semibold text-gray-900">{title}</figcaption>
      <svg
        viewBox={`0 ${viewTop} ${STAFF_RIGHT + 10} ${height}`}
        className="w-full max-w-[220px]"
        role="img"
        aria-label={caption}
      >
        {[0, 1, 2, 3, 4].map((line) => (
          <line
            key={line}
            x1={STAFF_LEFT}
            x2={STAFF_RIGHT}
            y1={yOf(line * 2)}
            y2={yOf(line * 2)}
            stroke="#9ca3af"
            strokeWidth={1}
          />
        ))}

        {notes.map((note) => {
          const y = yOf(note.position)
          // A note below the staff needs its own short line through it; only
          // even positions are lines, an odd one sits in the space between.
          const needsLedger = note.position < 0
          return (
            <g key={`${note.position}-${note.name}`}>
              {needsLedger && note.position % 2 === 0 ? (
                <line
                  x1={NOTE_X - 13}
                  x2={NOTE_X + 13}
                  y1={y}
                  y2={y}
                  stroke="#9ca3af"
                  strokeWidth={1}
                />
              ) : null}
              {note.accidental ? (
                <text
                  x={NOTE_X - 15}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-gray-900"
                  fontSize={13}
                  fontWeight={700}
                >
                  {note.accidental}
                </text>
              ) : null}
              <ellipse
                cx={NOTE_X}
                cy={y}
                rx={7.5}
                ry={5}
                fill={note.isRoot ? '#4f46e5' : '#ffffff'}
                stroke={note.isRoot ? '#4f46e5' : '#111827'}
                strokeWidth={1.6}
              />
              <text
                x={NOTE_X + 14}
                y={y + 4}
                fontSize={11}
                className={note.isRoot ? 'fill-indigo-700' : 'fill-gray-500'}
                fontWeight={note.isRoot ? 700 : 400}
              >
                {note.name}
                {note.accidental ?? ''}
              </text>
            </g>
          )
        })}

        {gapBelow !== undefined ? (
          (() => {
            const lower = yOf(notes[gapBelow].position)
            const upper = yOf(notes[gapBelow + 1].position)
            const x = NOTE_X - 30
            return (
              <g stroke="#e11d48" fill="none" strokeWidth={1.4}>
                <path d={`M ${x + 5} ${lower} L ${x} ${lower} L ${x} ${upper} L ${x + 5} ${upper}`} />
                <text
                  x={x - 3}
                  y={(lower + upper) / 2 + 3}
                  textAnchor="end"
                  fontSize={10}
                  className="fill-rose-600"
                  stroke="none"
                  fontWeight={700}
                >
                  4th
                </text>
              </g>
            )
          })()
        ) : null}
      </svg>
      <p className="text-xs leading-5 text-gray-600">{caption}</p>
    </figure>
  )
}
