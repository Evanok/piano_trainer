export const BACKING_TRACK_AUDIO_DIR = '/audio/backing-tracks'

// Downloaded from wikiloops.com (Blues/Drums-Bass-only), filtered by key
// letter -- the site's key filter doesn't distinguish major/minor, so these
// are assumed major. Only the keys we actually have takes for are listed;
// trainingGenerator.ts's KEYS has two more (B-flat major, E-flat major) that
// don't have a loop yet, so those simply play silently until takes are added.
// Multiple takes per key exist for variety -- one is picked at random per
// practice session.
const KEY_AUDIO_TAKES: Record<string, string[]> = {
  'C major': ['c1', 'c2', 'c3'],
  'D major': ['d1', 'd2'],
  'F major': ['f1', 'f2'],
  'G major': ['g1', 'g2'],
  'A major': ['a1', 'a2'],
}

export function backingTrackTakesFor(keyName: string): string[] {
  return KEY_AUDIO_TAKES[keyName] ?? []
}

export function backingTrackAudioUrl(keyName: string, pickRandom: () => number = Math.random): string | null {
  const takes = backingTrackTakesFor(keyName)
  if (takes.length === 0) {
    return null
  }
  const take = takes[Math.floor(pickRandom() * takes.length) % takes.length]
  return `${BACKING_TRACK_AUDIO_DIR}/${take}.wav`
}
