/**
 * Minimal note extraction from MusicXML: enough to place every sounding note
 * in time, and nothing more.
 *
 * Deliberately regex-driven rather than a full XML parse, for the same reason
 * `scoreMetadata.ts` is: Node has no DOM, and the alternative is a dependency
 * for a job that is a linear scan over a handful of well-known elements. What
 * is needed here is only where each note starts, how long it lasts and which
 * pitch it is -- no beams, no slurs, no layout.
 */

/** One sounding note. Times are in ticks at `TICKS_PER_QUARTER`. */
export interface ParsedNote {
  onset: number
  duration: number
  /** Standard MIDI note number (middle C = 60). */
  pitch: number
}

/**
 * A fixed internal resolution, so a score's own `<divisions>` (which may even
 * change mid-piece) never reaches the feature code, and so quantisation
 * thresholds can be expressed once in ticks.
 */
export const TICKS_PER_QUARTER = 480

/**
 * A repeated section is played twice, so it contributes twice as many notes.
 * Two of the grading features are ratios over the note count and shift
 * measurably when it changes -- measured on the catalog, leaving repeats folded
 * moved the predicted grade by 1.1 on average for the scores that have them,
 * more than the model's own error. Hence the unfolding below.
 *
 * A malformed score can carry a repeat structure that never terminates (the
 * same class of file that makes the practice cursor loop forever, see
 * `CursorIgnoreRepetitions` in `PianoScore.tsx`), so expansion is capped.
 */
const MAX_EXPANSION_FACTOR = 8

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function tagValue(chunk: string, tag: string): string | undefined {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(chunk)?.[1]
}

function numberValue(chunk: string, tag: string): number | null {
  const raw = tagValue(chunk, tag)
  if (raw === undefined) {
    return null
  }
  const value = Number.parseFloat(raw.trim())
  return Number.isFinite(value) ? value : null
}

function pitchOf(chunk: string): number | null {
  const step = tagValue(chunk, 'step')?.trim().toUpperCase()
  const octave = numberValue(chunk, 'octave')
  if (step === undefined || octave === null || !(step in STEP_SEMITONES)) {
    return null
  }
  const alter = numberValue(chunk, 'alter') ?? 0
  return (octave + 1) * 12 + STEP_SEMITONES[step] + Math.round(alter)
}

interface Measure {
  xml: string
  repeatStart: boolean
  repeatEnd: boolean
  /** How many times the section is played in total, from `<repeat times="n">`. */
  times: number
  /** Volta numbers this measure belongs to, empty when it is not under an ending. */
  endings: number[]
}

function readMeasures(body: string): Measure[] {
  const measures: Measure[] = []
  const pattern = /<measure\b[^>]*>([\s\S]*?)<\/measure>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const xml = match[1]
    const endingAttr = /<ending\b[^>]*\bnumber\s*=\s*["']([^"']*)["']/i.exec(xml)?.[1]
    measures.push({
      xml,
      repeatStart: /<repeat\b[^>]*\bdirection\s*=\s*["']forward["']/i.test(xml),
      repeatEnd: /<repeat\b[^>]*\bdirection\s*=\s*["']backward["']/i.test(xml),
      times: Number.parseInt(/<repeat\b[^>]*\btimes\s*=\s*["'](\d+)["']/i.exec(xml)?.[1] ?? '2', 10) || 2,
      endings: (endingAttr ?? '')
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((value) => Number.isFinite(value)),
    })
  }
  return measures
}

/**
 * The measures in the order they are actually played, expanding repeat
 * barlines and first/second endings.
 *
 * Jump directions (`D.C.`, `D.S.`, coda) are deliberately not followed: they
 * are rare in this catalog, ambiguous to interpret, and getting them wrong
 * would distort the note count in the same way folding a repeat does.
 */
function playbackOrder(measures: Measure[]): number[] {
  const order: number[] = []
  const limit = measures.length * MAX_EXPANSION_FACTOR
  const taken = new Map<number, number>()
  let sectionStart = 0
  let pass = 1
  let i = 0

  while (i < measures.length && order.length < limit) {
    const measure = measures[i]
    if (measure.repeatStart && i !== sectionStart) {
      sectionStart = i
      pass = 1
    }
    // A volta that does not apply on this pass is skipped whole.
    if (measure.endings.length > 0 && !measure.endings.includes(pass)) {
      i += 1
      while (i < measures.length && measures[i].endings.length === 0 && !measures[i].repeatStart) {
        i += 1
      }
      continue
    }
    order.push(i)
    if (measure.repeatEnd) {
      const done = (taken.get(i) ?? 1) + 1
      if (done <= measure.times) {
        taken.set(i, done)
        pass = done
        i = sectionStart
        continue
      }
      // Section finished: the next repeat starts a new one.
      sectionStart = i + 1
      pass = 1
    }
    i += 1
  }
  return order
}

/** Parses one `<part>` body, appending to `notes`. */
function parsePart(body: string, notes: ParsedNote[]): void {
  const measures = readMeasures(body)
  const chunks = measures.length > 0 ? playbackOrder(measures).map((i) => measures[i].xml) : [body]

  let divisions = 1
  let measureStart = 0
  const toTicks = (value: number): number => Math.round((value * TICKS_PER_QUARTER) / divisions)
  // Open ties, keyed by pitch, so a tie stop lengthens the note it continues.
  const sustaining = new Map<number, ParsedNote>()
  const element = /<(note|backup|forward|divisions)\b[^>]*>/gi

  for (const chunk of chunks) {
    let cursor = measureStart
    let measureEnd = measureStart
    let lastOnset = measureStart

    element.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = element.exec(chunk)) !== null) {
      const tag = match[1].toLowerCase()

      if (tag === 'divisions') {
        const value = Number.parseFloat(chunk.slice(element.lastIndex))
        if (Number.isFinite(value) && value > 0) {
          divisions = value
        }
        continue
      }

      if (tag === 'backup' || tag === 'forward') {
        const end = chunk.indexOf(`</${tag}`, match.index)
        const duration = numberValue(end === -1 ? '' : chunk.slice(match.index, end), 'duration') ?? 0
        cursor += tag === 'backup' ? -toTicks(duration) : toTicks(duration)
        measureEnd = Math.max(measureEnd, cursor)
        continue
      }

      const end = chunk.indexOf('</note>', match.index)
      if (end === -1) {
        break
      }
      const note = chunk.slice(match.index, end)
      element.lastIndex = end
      // A grace note carries no <duration>: it borrows time from its neighbour
      // and contributes nothing to placement, so it is skipped.
      if (/<grace\b/i.test(note)) {
        continue
      }
      const duration = toTicks(numberValue(note, 'duration') ?? 0)
      const isChordNote = /<chord\s*\/?>/i.test(note)
      const onset = isChordNote ? lastOnset : cursor

      if (!/<rest\b/i.test(note)) {
        const pitch = pitchOf(note)
        if (pitch !== null) {
          // A tie stop is the tail of a note already struck, so it lengthens
          // that note rather than counting again -- the same reasoning as the
          // practice pipeline's `isTieContinuation`.
          const held = /<tie\b[^>]*\btype\s*=\s*["']stop["']/i.test(note) ? sustaining.get(pitch) : undefined
          const startsTie = /<tie\b[^>]*\btype\s*=\s*["']start["']/i.test(note)
          if (held) {
            held.duration = onset + duration - held.onset
            if (!startsTie) {
              sustaining.delete(pitch)
            }
          } else {
            const parsed: ParsedNote = { onset, duration, pitch }
            notes.push(parsed)
            if (startsTie) {
              sustaining.set(pitch, parsed)
            }
          }
        }
      }

      if (!isChordNote) {
        cursor = onset + duration
      }
      measureEnd = Math.max(measureEnd, onset + duration)
      lastOnset = onset
    }
    measureStart = measureEnd
  }
}

/**
 * Every sounding note in the score, from all parts, sorted by onset.
 *
 * All parts are merged on purpose: the grading features describe the piece as
 * a whole, exactly as they were trained on MIDI renderings where the parts are
 * already mixed together.
 */
export function parseMusicXmlNotes(xml: string): ParsedNote[] {
  const notes: ParsedNote[] = []
  const partPattern = /<part\b[^>]*>([\s\S]*?)<\/part>/gi
  let match: RegExpExecArray | null
  while ((match = partPattern.exec(xml)) !== null) {
    parsePart(match[1], notes)
  }
  if (notes.length === 0) {
    // Some exports have no <part> wrapper the pattern can see (a truncated or
    // unusual file); fall back to scanning the whole document as one part.
    parsePart(xml, notes)
  }
  notes.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch)
  return notes
}
