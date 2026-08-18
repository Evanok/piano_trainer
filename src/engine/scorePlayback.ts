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
  let previousTimestamp = 0
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

// Walks a fresh, independent iterator over the whole piece
// (osmd.Sheet.MusicPartManager.getIterator()) instead of the shared
// osmd.cursor that PianoScore/WaitEngine use for the live practice position
// -- so previewing the score can never disturb the player's actual place,
// held notes, or coloring. Always both hands and the whole piece: this is a
// "remind me how it goes" preview, not subject to the current hand-mode/
// section-crop practice filtering.
export function extractTimedNotes(osmd: OpenSheetMusicDisplay): TimedNote[] {
  const sheet = osmd.Sheet
  if (!sheet) {
    return []
  }
  const instrument = playableInstrument(osmd)
  const iterator = sheet.MusicPartManager.getIterator()
  const steps: RawTimelineStep[] = []
  while (!iterator.EndReached) {
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
