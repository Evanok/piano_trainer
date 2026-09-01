/**
 * How much of the page OSMD drew the reading quiz's cropped measure into is
 * actually shown: the viewBox handed to the SVG.
 *
 * Pulled out of ReadingStaff.tsx so it can be unit-tested without a loaded OSMD
 * and without a DOM, the same way ScoreParser's selectHandStaff is: every input
 * here is structurally typed, so a plain object stands in for an OSMD instance
 * or for an SVG element.
 *
 * Four things went wrong before this shape, all worth remembering:
 *  - OSMD renders a whole page into that SVG and puts the cropped measure in
 *    its top left corner, so left alone the staff occupies a tenth of the
 *    screen whatever the container's size.
 *  - Sizing the SVG with width/height 100% does nothing: OSMD wraps it in a div
 *    it sizes itself, so the percentages resolve against nothing and the SVG
 *    keeps its page-sized layout box. It has to be given explicit pixels.
 *  - The staffline's model box is NOT the five lines centred on their middle
 *    (it covers the staffline's whole region), so treating it as such and
 *    centring a window on it cut the top of the staff off. Uniting it with the
 *    drawn content's box makes clipping impossible whatever it turns out to be.
 *  - There is one staffline, and one g.vf-measure element, PER STAVE. A grand
 *    staff round (clefMode 'both') therefore draws two of each, and a bass
 *    question's note lives entirely on the second: a window built from the
 *    first alone left the note off screen, so the question looked like it had
 *    no note at all while a treble-only round was fine. Both are unioned over
 *    all of them, never indexed at [0].
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Just enough of an SVGGraphicsElement to measure it. */
interface MeasurableLike {
  getBBox(): Box
}

/** Just enough of an OSMD instance to locate its stafflines. */
interface OsmdLike {
  Zoom?: number
  GraphicSheet?: {
    MusicPages?: ReadonlyArray<{
      MusicSystems?: ReadonlyArray<{
        StaffLines?: ReadonlyArray<{
          PositionAndShape?: {
            AbsolutePosition: { x: number; y: number }
            Size: { width: number; height: number }
          }
        }>
      }>
    }>
  }
}

// OSMD lays a page out in its own abstract units, rendered at 10px per unit
// before the zoom multiplier, and the SVG's user coordinates are those pixels.
const OSMD_PIXELS_PER_UNIT = 10

export const VIEW_VERTICAL_PADDING_FRACTION = 0.12
export const VIEW_HORIZONTAL_PADDING_FRACTION = 0.05

export function unionBoxes(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) {
    return a ?? b
  }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

export function boxOf(element: MeasurableLike | null | undefined): Box | null {
  if (!element) {
    return null
  }
  try {
    const box = element.getBBox()
    return box.width > 0 && box.height > 0 ? box : null
  } catch {
    // getBBox throws on an element that is not rendered yet.
    return null
  }
}

/** The union of EVERY staffline's model box: see the note above about staves. */
export function modelStaffBox(osmd: OsmdLike | null | undefined): Box | null {
  const scale = OSMD_PIXELS_PER_UNIT * (osmd?.Zoom ?? 1)
  let box: Box | null = null
  for (const system of osmd?.GraphicSheet?.MusicPages?.[0]?.MusicSystems ?? []) {
    for (const staffLine of system?.StaffLines ?? []) {
      const shape = staffLine?.PositionAndShape
      if (!shape) {
        continue
      }
      const candidate = {
        x: shape.AbsolutePosition.x * scale,
        y: shape.AbsolutePosition.y * scale,
        width: shape.Size.width * scale,
        height: shape.Size.height * scale,
      }
      if (candidate.width > 0 && candidate.height > 0) {
        box = unionBoxes(box, candidate)
      }
    }
  }
  return box
}

/** The union of every drawn stave's box, falling back to the whole SVG. */
export function drawnBox(
  svg: (MeasurableLike & { querySelectorAll(selectors: string): ArrayLike<MeasurableLike> }) | null,
): Box | null {
  if (!svg) {
    return null
  }
  let box: Box | null = null
  const measures = svg.querySelectorAll('g.vf-measure')
  for (let i = 0; i < measures.length; i += 1) {
    box = unionBoxes(box, boxOf(measures[i]))
  }
  return box ?? boxOf(svg)
}

/** The viewBox attribute value for what a cropped question actually drew. */
export function staffViewBox(osmd: OsmdLike | null, box: Box | null): string | null {
  const full = unionBoxes(modelStaffBox(osmd), box)
  if (!full) {
    return null
  }
  const padX = full.width * VIEW_HORIZONTAL_PADDING_FRACTION
  const padY = full.height * VIEW_VERTICAL_PADDING_FRACTION
  return `${full.x - padX} ${full.y - padY} ${full.width + padX * 2} ${full.height + padY * 2}`
}
