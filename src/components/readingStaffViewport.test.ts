import { describe, expect, it } from 'vitest'

import { drawnBox, modelStaffBox, staffViewBox } from './readingStaffViewport'

function staffLine(x: number, y: number, width: number, height: number) {
  return {
    PositionAndShape: {
      AbsolutePosition: { x, y },
      Size: { width, height },
    },
  }
}

function osmdWith(...lines: ReturnType<typeof staffLine>[]) {
  return { Zoom: 1, GraphicSheet: { MusicPages: [{ MusicSystems: [{ StaffLines: lines }] }] } }
}

function fakeSvg(boxes: Array<{ x: number; y: number; width: number; height: number }>) {
  const measures = boxes.map((box) => ({ getBBox: () => box }))
  return {
    getBBox: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
    querySelectorAll: () => measures,
  }
}

describe('modelStaffBox', () => {
  it('covers both staves of a grand staff, not just the first', () => {
    // Treble at the top, bass 10 units below it: a bass question's note is only
    // ever inside the second one, and indexing StaffLines[0] hid it entirely.
    const box = modelStaffBox(osmdWith(staffLine(1, 1, 10, 4), staffLine(1, 10, 10, 4)))
    expect(box).toEqual({ x: 10, y: 10, width: 100, height: 130 })
  })

  it('scales the model units by the zoom', () => {
    const osmd = { ...osmdWith(staffLine(1, 1, 10, 4)), Zoom: 2 }
    expect(modelStaffBox(osmd)).toEqual({ x: 20, y: 20, width: 200, height: 80 })
  })

  it('answers null when nothing has been laid out', () => {
    expect(modelStaffBox(null)).toBeNull()
    expect(modelStaffBox({ GraphicSheet: { MusicPages: [] } })).toBeNull()
    expect(modelStaffBox(osmdWith(staffLine(0, 0, 0, 0)))).toBeNull()
  })
})

describe('drawnBox', () => {
  it('unions every drawn stave, since g.vf-measure is per stave', () => {
    expect(drawnBox(fakeSvg([
      { x: 0, y: 0, width: 50, height: 40 },
      { x: 0, y: 100, width: 60, height: 40 },
    ]))).toEqual({ x: 0, y: 0, width: 60, height: 140 })
  })

  it('falls back to the whole SVG when no stave is measurable', () => {
    expect(drawnBox(fakeSvg([]))).toEqual({ x: 0, y: 0, width: 1000, height: 1000 })
  })
})

describe('staffViewBox', () => {
  it('encloses the lowest drawn stave', () => {
    const viewBox = staffViewBox(osmdWith(staffLine(1, 1, 10, 4)), {
      x: 10,
      y: 100,
      width: 60,
      height: 40,
    })
    const [x, y, width, height] = (viewBox ?? '').split(' ').map(Number)
    expect(x).toBeLessThanOrEqual(10)
    expect(y).toBeLessThanOrEqual(10)
    expect(x + width).toBeGreaterThanOrEqual(110)
    expect(y + height).toBeGreaterThanOrEqual(140)
  })

  it('answers null with nothing to show', () => {
    expect(staffViewBox(null, null)).toBeNull()
  })
})
