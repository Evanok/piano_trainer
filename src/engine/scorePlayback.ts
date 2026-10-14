import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { isTieContinuation, noteToMidi, playableInstrument } from './ScoreParser'

const DEFAULT_BPM = 120
// MusicXML/OSMD tempo (BPM) counts quarter notes per minute, and a whole note
// is 4 quarter notes -- so at 1 BPM a whole note would last 240 seconds.
const SECONDS_PER_WHOLE_NOTE_AT_ONE_BPM = 240

export interface TimedNote {
  pitches: number[]
  startSeconds: number
  durationSeconds: number
}

// One raw cursor step, decoupled from OSMD so the actual time math (handling
// a tempo that changes partway through the piece) can be unit-tested without
// a loaded score -- see scorePlayback.test.ts.
export interface RawTimelineStep {
  pitches: number[]
  timestampWholeNotes: number
  lengthWholeNotes: number
  bpm: number
}

function normalizeBpm(bpm: number): number {
  return bpm > 0 ? bpm : DEFAULT_BPM
}

// Converts raw cursor steps (each carrying its own absolute position and the
// tempo active there) into real playback seconds. Seconds are accumulated
// incrementally between consecutive steps, rather than multiplying the
// absolute timestamp by one constant tempo -- a piece with a tempo change
// partway through would otherwise play the back half at the wrong speed.
//
// The gap since the PREVIOUS step is the previous step's note ringing out, so
// it must use the tempo that was active back then, not the new step's tempo:
// a tempo instruction at this step's timestamp takes effect starting here, it
// doesn't apply retroactively to the note that just finished.
export function buildTimeline(steps: RawTimelineStep[]): TimedNote[] {
  const notes: TimedNote[] = []
  // Time starts at the first step, not at the top of the piece: a range that
  // begins at measure 21 must start sounding at once, not after 20 measures
  // of silence.
  let previousTimestamp = steps.length > 0 ? steps[0].timestampWholeNotes : 0
  let previousBpm = steps.length > 0 ? normalizeBpm(steps[0].bpm) : DEFAULT_BPM
  let elapsedSeconds = 0
  for (const step of steps) {
    const bpm = normalizeBpm(step.bpm)
    elapsedSeconds += (step.timestampWholeNotes - previousTimestamp) * (SECONDS_PER_WHOLE_NOTE_AT_ONE_BPM / previousBpm)
    previousTimestamp = step.timestampWholeNotes
    previousBpm = bpm
    if (step.pitches.length > 0) {
      notes.push({
        pitches: step.pitches,
        startSeconds: elapsedSeconds,
        durationSeconds: step.lengthWholeNotes * (SECONDS_PER_WHOLE_NOTE_AT_ONE_BPM / bpm),
      })
    }
  }
  return notes
}

export interface PlaybackRange {
  startMeasure: number // 1-based, sequential (Sheet.SourceMeasures index + 1)
  endMeasure: number // inclusive
}

// Walks a fresh, independent iterator (osmd.Sheet.MusicPartManager
// .getIterator()) instead of the shared osmd.cursor that PianoScore/WaitEngine
// use for the live practice position -- so previewing the score can never
// disturb the player's actual place, held notes, or coloring. Always both
// hands: this is a "remind me how it goes" preview, not subject to hand mode.
//
// The start is always passed explicitly. Called without one, getIterator()
// starts at Sheet.SelectionStart, which a section or loop crop rewrites to the
// first drawn measure -- so the preview silently followed whatever crop
// happened to be on screen. `range` (null = whole piece) is the only thing
// that decides what is played.
export function extractTimedNotes(osmd: OpenSheetMusicDisplay, range: PlaybackRange | null = null): TimedNote[] {
  const sheet = osmd.Sheet
  if (!sheet || sheet.SourceMeasures.length === 0) {
    return []
  }
  const lastIndex = sheet.SourceMeasures.length - 1
  const startIndex = range ? Math.min(Math.max(range.startMeasure - 1, 0), lastIndex) : 0
  const endIndex = range ? Math.min(Math.max(range.endMeasure - 1, startIndex), lastIndex) : lastIndex
  const instrument = playableInstrument(osmd)
  const iterator = sheet.MusicPartManager.getIterator(sheet.SourceMeasures[startIndex].AbsoluteTimestamp.clone())
  const steps: RawTimelineStep[] = []
  while (!iterator.EndReached && iterator.CurrentMeasureIndex <= endIndex) {
    const pitches = new Set<number>()
    let lengthWholeNotes = 0
    for (const entry of iterator.CurrentVoiceEntries) {
      for (const note of entry.Notes) {
        if (note.isRest() || isTieContinuation(note)) {
          continue
        }
        if (instrument && note.ParentStaff?.ParentInstrument !== instrument) {
          continue
        }
        pitches.add(noteToMidi(note))
        lengthWholeNotes = Math.max(lengthWholeNotes, note.Length.RealValue)
      }
    }
    steps.push({
      pitches: Array.from(pitches),
      timestampWholeNotes: iterator.CurrentSourceTimestamp.RealValue,
      lengthWholeNotes,
      bpm: iterator.CurrentBpm,
    })
    iterator.moveToNext()
  }
  return buildTimeline(steps)
}
