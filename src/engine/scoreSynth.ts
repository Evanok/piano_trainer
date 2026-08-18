import type { TimedNote } from './scorePlayback'

const ATTACK_SECONDS = 0.012
const RELEASE_SECONDS = 0.15
const NOTE_GAIN = 0.18
// Scheduling everything a little in the future of audioContext.currentTime,
// not at it, since 0 can land in the past by the time the browser actually
// starts the oscillator and gets silently dropped.
const SCHEDULE_LEAD_SECONDS = 0.05
const STOP_FADE_SECONDS = 0.03

function midiToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

/**
 * Plays back a score's notes as plain Web Audio oscillators -- deliberately
 * not a sampled/soundfont piano, so this preview needs no extra dependency and
 * no network fetch of audio samples. Good enough to recall a tune, not meant
 * to sound like a real piano.
 */
export class ScoreSynth {
  private audioContext: AudioContext | null = null
  private activeNodes: Array<{ oscillator: OscillatorNode; gain: GainNode }> = []
  private finishTimeoutId: ReturnType<typeof setTimeout> | null = null

  get isPlaying(): boolean {
    return this.audioContext !== null
  }

  play(notes: TimedNote[], onFinished: () => void): void {
    this.stop()
    if (notes.length === 0) {
      onFinished()
      return
    }
    const audioContext = new AudioContext()
    this.audioContext = audioContext
    const startTime = audioContext.currentTime + SCHEDULE_LEAD_SECONDS
    let latestEnd = 0

    for (const note of notes) {
      const noteStart = startTime + note.startSeconds
      // A short minimum sustain keeps very brief notes (e.g. fast runs)
      // audible instead of being swallowed by the attack/release envelope.
      const sustain = Math.max(note.durationSeconds - 0.02, 0.05)
      const noteEnd = noteStart + sustain
      for (const pitch of note.pitches) {
        const oscillator = audioContext.createOscillator()
        oscillator.type = 'triangle'
        oscillator.frequency.value = midiToFrequency(pitch)
        const gain = audioContext.createGain()
        gain.gain.setValueAtTime(0, noteStart)
        gain.gain.linearRampToValueAtTime(NOTE_GAIN, noteStart + ATTACK_SECONDS)
        gain.gain.setValueAtTime(NOTE_GAIN, Math.max(noteStart + ATTACK_SECONDS, noteEnd - RELEASE_SECONDS))
        gain.gain.linearRampToValueAtTime(0, noteEnd + RELEASE_SECONDS)
        oscillator.connect(gain)
        gain.connect(audioContext.destination)
        oscillator.start(noteStart)
        oscillator.stop(noteEnd + RELEASE_SECONDS + 0.02)
        this.activeNodes.push({ oscillator, gain })
      }
      latestEnd = Math.max(latestEnd, noteEnd + RELEASE_SECONDS)
    }

    this.finishTimeoutId = setTimeout(() => {
      this.stop()
      onFinished()
    }, (latestEnd + 0.1) * 1000)
  }

  stop(): void {
    if (this.finishTimeoutId !== null) {
      clearTimeout(this.finishTimeoutId)
      this.finishTimeoutId = null
    }
    const audioContext = this.audioContext
    if (audioContext) {
      // A manual Stop mid-note would otherwise hard-cut every currently
      // sounding oscillator (an audible click) -- fade each one out fast
      // instead of just calling oscillator.stop() immediately.
      const now = audioContext.currentTime
      for (const { oscillator, gain } of this.activeNodes) {
        try {
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(gain.gain.value, now)
          gain.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS)
          oscillator.stop(now + STOP_FADE_SECONDS + 0.01)
        } catch {
          // Already stopped -- nothing to do.
        }
      }
      setTimeout(() => void audioContext.close(), (STOP_FADE_SECONDS + 0.05) * 1000)
    }
    this.activeNodes = []
    this.audioContext = null
  }
}
