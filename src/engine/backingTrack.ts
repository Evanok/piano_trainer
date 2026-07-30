export interface SoftPadVoice {
  midi: number
  gain: number
  detuneCents: number
  type: OscillatorType
}

function normalizePitchClass(pitchClass: number): number {
  return ((Math.round(pitchClass) % 12) + 12) % 12
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

export function tonicPadMidi(pitchClass: number): number {
  return 48 + normalizePitchClass(pitchClass)
}

export function buildSoftPadVoices(tonicPitchClass: number): SoftPadVoice[] {
  const tonic = tonicPadMidi(tonicPitchClass)
  return [
    { midi: tonic, gain: 0.55, detuneCents: -3, type: 'sine' },
    { midi: tonic + 7, gain: 0.35, detuneCents: 2, type: 'sine' },
    { midi: tonic + 12, gain: 0.24, detuneCents: 4, type: 'triangle' },
  ]
}
