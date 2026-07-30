export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function normalizePitchClass(pitchClass: number): number {
  return ((Math.round(pitchClass) % 12) + 12) % 12
}

// Every generated-exercise key is currently major (see trainingGenerator.ts's
// KEYS), so a plain major-scale interval table is enough to derive diatonic
// chord roots from just the tonic pitch class, without threading the full
// scale array through PracticeBackingTrack.
const MAJOR_SCALE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]

export const BACKING_TRACK_BPM = 84
export const BEATS_PER_BAR = 4

// I - V - vi - IV, one bar per chord, looping: a basic diatonic pop
// progression expressed as scale degrees, so it stays valid across every key.
const PROGRESSION_DEGREES = [0, 4, 5, 3]

const BASS_OCTAVE_BASE = 36 // C2: root notes land between C2 and B2.

export function bassMidiForDegree(tonicPitchClass: number, degree: number): number {
  const semitone = MAJOR_SCALE_SEMITONES[degree % MAJOR_SCALE_SEMITONES.length]
  return BASS_OCTAVE_BASE + normalizePitchClass(tonicPitchClass + semitone)
}

export function buildBassProgression(tonicPitchClass: number): number[] {
  return PROGRESSION_DEGREES.map((degree) => bassMidiForDegree(tonicPitchClass, degree))
}
