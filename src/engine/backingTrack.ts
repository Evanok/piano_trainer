export const BACKING_TRACK_AUDIO_DIR = '/audio/backing-tracks'

interface BackingTrackTake {
  source: 'adg-blues' | 'paul-maine-jazz'
  fileName: string
}

// Both collections contain a performance recorded/rendered specifically in
// each of the 12 major keys. Keeping the source folders separate makes the
// catalogue easy to audit and lets us add more complete collections later.
const MAJOR_KEY_AUDIO_TAKES: Record<string, BackingTrackTake[]> = {
  'C major': takes('C'),
  'D-flat major': takes('Db'),
  'D major': takes('D'),
  'E-flat major': takes('Eb'),
  'E major': takes('E'),
  'F major': takes('F'),
  'G-flat major': takes('Gb'),
  'G major': takes('G'),
  'A-flat major': takes('Ab'),
  'A major': takes('A'),
  'B-flat major': takes('Bb'),
  'B major': takes('B'),
}

function takes(key: string): BackingTrackTake[] {
  return [
    { source: 'adg-blues', fileName: `${key}-major.m4a` },
    { source: 'paul-maine-jazz', fileName: `${key}-major.mp3` },
  ]
}

export function backingTrackTakesFor(keyName: string): readonly BackingTrackTake[] {
  return MAJOR_KEY_AUDIO_TAKES[keyName] ?? []
}

export function backingTrackAudioUrl(keyName: string, pickRandom: () => number = Math.random): string | null {
  const availableTakes = backingTrackTakesFor(keyName)
  if (availableTakes.length === 0) {
    return null
  }

  const take = availableTakes[Math.floor(pickRandom() * availableTakes.length) % availableTakes.length]
  return `${BACKING_TRACK_AUDIO_DIR}/${take.source}/${take.fileName}`
}
