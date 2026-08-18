import { describe, expect, it } from 'vitest'
import { buildTimeline, type RawTimelineStep } from './scorePlayback'

describe('buildTimeline', () => {
  it('converts whole-note timestamps to seconds at a constant tempo', () => {
    // 120 BPM -> 2 seconds per whole note -> 0.5s per quarter note.
    const steps: RawTimelineStep[] = [
      { pitches: [60], timestampWholeNotes: 0, lengthWholeNotes: 0.25, bpm: 120 },
      { pitches: [62], timestampWholeNotes: 0.25, lengthWholeNotes: 0.25, bpm: 120 },
      { pitches: [64], timestampWholeNotes: 0.5, lengthWholeNotes: 0.5, bpm: 120 },
    ]

    expect(buildTimeline(steps)).toEqual([
      { pitches: [60], startSeconds: 0, durationSeconds: 0.5 },
      { pitches: [62], startSeconds: 0.5, durationSeconds: 0.5 },
      { pitches: [64], startSeconds: 1, durationSeconds: 1 },
    ])
  })

  it('skips steps with no required pitches (rests) without breaking later timing', () => {
    const steps: RawTimelineStep[] = [
      { pitches: [60], timestampWholeNotes: 0, lengthWholeNotes: 0.25, bpm: 120 },
      { pitches: [], timestampWholeNotes: 0.25, lengthWholeNotes: 0.25, bpm: 120 },
      { pitches: [64], timestampWholeNotes: 0.5, lengthWholeNotes: 0.25, bpm: 120 },
    ]

    expect(buildTimeline(steps)).toEqual([
      { pitches: [60], startSeconds: 0, durationSeconds: 0.5 },
      { pitches: [64], startSeconds: 1, durationSeconds: 0.5 },
    ])
  })

  it('accounts for a tempo change partway through the piece', () => {
    // First half at 120 BPM (2s/whole note), second half at 60 BPM (4s/whole note).
    const steps: RawTimelineStep[] = [
      { pitches: [60], timestampWholeNotes: 0, lengthWholeNotes: 0.25, bpm: 120 },
      { pitches: [62], timestampWholeNotes: 0.25, lengthWholeNotes: 0.25, bpm: 60 },
      { pitches: [64], timestampWholeNotes: 0.5, lengthWholeNotes: 0.25, bpm: 60 },
    ]

    expect(buildTimeline(steps)).toEqual([
      { pitches: [60], startSeconds: 0, durationSeconds: 0.5 },
      { pitches: [62], startSeconds: 0.5, durationSeconds: 1 },
      { pitches: [64], startSeconds: 1.5, durationSeconds: 1 },
    ])
  })

  it('falls back to a default tempo when bpm is not positive', () => {
    // 120 BPM default -> 2s per whole note.
    const steps: RawTimelineStep[] = [{ pitches: [60], timestampWholeNotes: 0, lengthWholeNotes: 0.25, bpm: 0 }]

    expect(buildTimeline(steps)).toEqual([{ pitches: [60], startSeconds: 0, durationSeconds: 0.5 }])
  })
})
