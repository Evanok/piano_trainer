import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import fixtures from './gradeModel.fixtures.json' with { type: 'json' }
import model from './gradeModel.json' with { type: 'json' }
import { predictGrade, type GradeModel } from './lightgbm.ts'
import { parseMusicXmlNotes, TICKS_PER_QUARTER as TPQ } from './musicXmlNotes.ts'
import { computeGradeFeatures, FEATURE_ORDER } from './gradeFeatures.ts'
import { estimateScoreGrade, gradeFromXml } from './index.ts'

function score(parts: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  ${parts}
</score-partwise>`
}

function note(step: string, octave: number, duration: number, extra = ''): string {
  return `<note>${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration></note>`
}

describe('parseMusicXmlNotes', () => {
  it('places notes sequentially and converts pitch to MIDI', () => {
    const xml = score(`<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${note('C', 4, 1)}${note('D', 4, 1)}${note('B', 3, 2)}
    </measure></part>`)
    expect(parseMusicXmlNotes(xml)).toEqual([
      { onset: 0, duration: TPQ, pitch: 60 },
      { onset: TPQ, duration: TPQ, pitch: 62 },
      { onset: 2 * TPQ, duration: 2 * TPQ, pitch: 59 },
    ])
  })

  it('applies alter, and honours a divisions value other than one', () => {
    const xml = score(`<part id="P1"><measure number="1">
      <attributes><divisions>4</divisions></attributes>
      ${note('F', 4, 2, '<pitch-placeholder/>').replace('<octave>4</octave>', '<alter>1</alter><octave>4</octave>')}
    </measure></part>`)
    expect(parseMusicXmlNotes(xml)).toEqual([{ onset: 0, duration: TPQ / 2, pitch: 66 }])
  })

  it('stacks chord notes on one onset and does not advance time twice', () => {
    const xml = score(`<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${note('C', 4, 1)}${note('E', 4, 1, '<chord/>')}${note('G', 4, 1, '<chord/>')}${note('D', 4, 1)}
    </measure></part>`)
    expect(parseMusicXmlNotes(xml)).toEqual([
      { onset: 0, duration: TPQ, pitch: 60 },
      { onset: 0, duration: TPQ, pitch: 64 },
      { onset: 0, duration: TPQ, pitch: 67 },
      { onset: TPQ, duration: TPQ, pitch: 62 },
    ])
  })

  it('rewinds on backup, so a second staff starts at the measure again', () => {
    const xml = score(`<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${note('C', 5, 2)}<backup><duration>2</duration></backup>${note('C', 3, 2)}
    </measure></part>`)
    expect(parseMusicXmlNotes(xml)).toEqual([
      { onset: 0, duration: 2 * TPQ, pitch: 48 },
      { onset: 0, duration: 2 * TPQ, pitch: 72 },
    ])
  })

  it('skips rests and grace notes but keeps the time a rest occupies', () => {
    const xml = score(`<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><rest/><duration>1</duration></note>
      <note><grace/><pitch><step>B</step><octave>3</octave></pitch></note>
      ${note('C', 4, 1)}
    </measure></part>`)
    expect(parseMusicXmlNotes(xml)).toEqual([{ onset: TPQ, duration: TPQ, pitch: 60 }])
  })

  it('merges a tied note into the note it continues instead of counting it twice', () => {
    const xml = score(`<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${note('C', 4, 2, '<tie type="start"/>')}
    </measure><measure number="2">
      ${note('C', 4, 2, '<tie type="stop"/>')}
    </measure></part>`)
    expect(parseMusicXmlNotes(xml)).toEqual([{ onset: 0, duration: 4 * TPQ, pitch: 60 }])
  })

  it('merges every part into one list', () => {
    const xml = score(`<part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>${note('C', 4, 1)}
    </measure></part>
    <part id="P2"><measure number="1">
      <attributes><divisions>1</divisions></attributes>${note('C', 3, 1)}
    </measure></part>`)
    expect(parseMusicXmlNotes(xml).map((n) => n.pitch)).toEqual([48, 60])
  })
})

describe('computeGradeFeatures', () => {
  it('returns one value per feature, in the order the model expects', () => {
    const notes = [
      { onset: 0, duration: TPQ, pitch: 60 },
      { onset: 0, duration: TPQ, pitch: 64 },
      { onset: TPQ, duration: TPQ / 4, pitch: 72 },
    ]
    const features = computeGradeFeatures(notes)
    expect(features).toHaveLength(FEATURE_ORDER.length)
    expect(FEATURE_ORDER).toEqual((model as GradeModel).features)
  })

  it('measures simultaneity, register and texture', () => {
    const chord = [
      { onset: 0, duration: TPQ, pitch: 40 },
      { onset: 0, duration: TPQ, pitch: 60 },
      { onset: 0, duration: TPQ, pitch: 79 },
    ]
    const f = computeGradeFeatures(chord)
    const at = (name: string) => f[FEATURE_ORDER.indexOf(name as (typeof FEATURE_ORDER)[number])]
    expect(at('max_polyphony')).toBe(3)
    expect(at('chord_ratio')).toBe(1)
    expect(at('pitch_range')).toBe(39)
    expect(at('num_distinct_pitches')).toBe(3)
    // 40 is below C3, 79 is above C6, 60 is neither.
    expect(at('low_ratio')).toBeCloseTo(1 / 3, 6)
    expect(at('high_ratio')).toBeCloseTo(1 / 3, 6)
    // Gaps over an octave between consecutive sorted pitches: 40->60 and 60->79.
    expect(at('wide_leap_ratio')).toBeCloseTo(2 / 3, 6)
  })


  it('ignores how long notes are held, since a rendering shortens them', () => {
    const asWritten = [
      { onset: 0, duration: TPQ, pitch: 60 },
      { onset: TPQ, duration: TPQ, pitch: 64 },
      { onset: 2 * TPQ, duration: TPQ, pitch: 67 },
    ]
    // The same notes as a MIDI renderer would write them: one tick shorter.
    const asRendered = asWritten.map((note) => ({ ...note, duration: note.duration - 1 }))
    expect(computeGradeFeatures(asRendered)).toEqual(computeGradeFeatures(asWritten))
  })

  it('is all zeros for an empty score rather than throwing', () => {
    expect(computeGradeFeatures([])).toEqual(FEATURE_ORDER.map(() => 0))
  })
})

describe('predictGrade', () => {
  it('reproduces the reference predictions from the training pipeline', () => {
    for (const [i, features] of fixtures.features.entries()) {
      expect(predictGrade(model as GradeModel, features)).toBeCloseTo(fixtures.expected[i], 4)
    }
  })

  it('rejects a feature vector of the wrong length', () => {
    expect(() => predictGrade(model as GradeModel, [1, 2, 3])).toThrow(/expected 9 features/)
  })
})

describe('estimateScoreGrade', () => {
  const body = Array.from({ length: 24 }, (_, i) => note('CDEFGAB'[i % 7], 3 + (i % 3), 1)).join('')
  const playable = score(`<part id="P1"><measure number="1">
    <attributes><divisions>1</divisions></attributes>${body}
  </measure></part>`)

  it('grades a plain .musicxml file on the 1-8 scale', async () => {
    const grade = await estimateScoreGrade('piece.musicxml', Buffer.from(playable, 'utf8'))
    expect(grade).not.toBeNull()
    expect(grade!.value).toBeGreaterThanOrEqual(1)
    expect(grade!.value).toBeLessThanOrEqual(8)
    expect(grade!.gradeVersion).toBe(1)
  })

  it('reads the score out of a compressed .mxl', async () => {
    const zip = new JSZip()
    zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>')
    zip.file('score.xml', playable)
    const data = await zip.generateAsync({ type: 'nodebuffer' })
    expect(await estimateScoreGrade('piece.mxl', data)).toEqual(await estimateScoreGrade('piece.musicxml', Buffer.from(playable, 'utf8')))
  })

  it('returns null for a score too short to say anything about', () => {
    expect(gradeFromXml(score(`<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${note('C', 4, 1)}</measure></part>`))).toBeNull()
  })

  it('returns null rather than throwing on unreadable input', async () => {
    expect(await estimateScoreGrade('broken.mxl', Buffer.from('not a zip'))).toBeNull()
    expect(await estimateScoreGrade('empty.musicxml', Buffer.from(''))).toBeNull()
  })
})
