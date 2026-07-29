import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractFromXml, extractScoreMetadata } from './scoreMetadata.ts'

function scoreXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
${body}
  <part-list></part-list>
</score-partwise>`
}

const FULL_METADATA = scoreXml(`  <work><work-title>Album for the Young</work-title></work>
  <identification>
    <creator type="composer">Pyotr Ilyich Tchaikovsky</creator>
    <creator type="lyricist">Someone Else</creator>
  </identification>`)

async function buildMxl(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('extractFromXml', () => {
  it('reads the work title and the composer', () => {
    expect(extractFromXml(FULL_METADATA)).toEqual({
      title: 'Album for the Young',
      composer: 'Pyotr Ilyich Tchaikovsky',
    })
  })

  it('falls back to the movement title', () => {
    const xml = scoreXml('  <movement-title>Mama</movement-title>')
    expect(extractFromXml(xml).title).toBe('Mama')
  })

  it('prefers the work title over the movement title', () => {
    const xml = scoreXml(`  <work><work-title>Album for the Young</work-title></work>
  <movement-title>Mama</movement-title>`)
    expect(extractFromXml(xml).title).toBe('Album for the Young')
  })

  it('picks the composer, not another creator', () => {
    const xml = scoreXml(`  <identification>
    <creator type="arranger">An Arranger</creator>
    <creator type="composer">The Composer</creator>
  </identification>`)
    expect(extractFromXml(xml).composer).toBe('The Composer')
  })

  it('decodes XML entities and collapses whitespace', () => {
    const xml = scoreXml('  <work><work-title>  Fr&#232;re   Jacques &amp; Friends </work-title></work>')
    expect(extractFromXml(xml).title).toBe('Frère Jacques & Friends')
  })

  it('keeps only the first line of a title or creator written in two languages', () => {
    const xml = scoreXml(`  <work><work-title>
Album for the young
&#1044;&#1077;&#1090;&#1089;&#1082;&#1080;&#1081; &#1072;&#1083;&#1100;&#1073;&#1086;&#1084;
</work-title></work>
  <identification><creator type="composer">Pyotr Ilyich Tchaikovsky
&#1063;&#1072;&#1081;&#1082;&#1086;&#1074;&#1089;&#1082;&#1080;&#1081;</creator></identification>`)
    expect(extractFromXml(xml)).toEqual({
      title: 'Album for the young',
      composer: 'Pyotr Ilyich Tchaikovsky',
    })
  })

  it('treats an empty element as absent', () => {
    const xml = scoreXml('  <work><work-title>   </work-title></work>')
    expect(extractFromXml(xml)).toEqual({ title: null, composer: null })
  })

  it('returns nulls when the score carries no metadata', () => {
    expect(extractFromXml(scoreXml(''))).toEqual({ title: null, composer: null })
  })

  it('truncates an absurdly long title', () => {
    const xml = scoreXml(`  <work><work-title>${'x'.repeat(500)}</work-title></work>`)
    expect((extractFromXml(xml).title as string).length).toBeLessThanOrEqual(203)
  })
})

describe('extractScoreMetadata', () => {
  it('reads a plain .musicxml file', async () => {
    const metadata = await extractScoreMetadata('score.musicxml', Buffer.from(FULL_METADATA, 'utf8'))
    expect(metadata).toEqual({ title: 'Album for the Young', composer: 'Pyotr Ilyich Tchaikovsky' })
  })

  it('reads a compressed .mxl through its container manifest', async () => {
    const mxl = await buildMxl({
      'META-INF/container.xml':
        '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
      'score.xml': FULL_METADATA,
      // A decoy that would win if the container manifest were ignored.
      'aaa-other.xml': scoreXml('  <work><work-title>Wrong One</work-title></work>'),
    })
    expect(await extractScoreMetadata('score.mxl', mxl)).toEqual({
      title: 'Album for the Young',
      composer: 'Pyotr Ilyich Tchaikovsky',
    })
  })

  it('falls back to the first XML entry when there is no container manifest', async () => {
    const mxl = await buildMxl({ 'score.xml': FULL_METADATA })
    expect((await extractScoreMetadata('score.mxl', mxl)).title).toBe('Album for the Young')
  })

  it('returns nulls instead of throwing on a file that is not a zip', async () => {
    expect(await extractScoreMetadata('broken.mxl', Buffer.from('not a zip at all'))).toEqual({
      title: null,
      composer: null,
    })
  })
})
