import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addScore,
  extensionOf,
  findEntry,
  migrateCatalog,
  readCatalog,
  resolveDataDir,
  scoreFilePath,
  titleFromFilename,
} from './catalogStore.ts'

const SCORE_WITH_METADATA = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <work><work-title>Album for the Young</work-title></work>
  <identification><creator type="composer">Pyotr Ilyich Tchaikovsky</creator></identification>
  <part-list></part-list>
</score-partwise>`

const SCORE_WITHOUT_METADATA = '<?xml version="1.0"?><score-partwise><part-list></part-list></score-partwise>'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'piano-trainer-catalog-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('addScore', () => {
  it('stores the bytes and makes them readable back through the catalog', async () => {
    const data = Buffer.from(SCORE_WITHOUT_METADATA)
    const entry = await addScore(dataDir, 'clair-de-lune.musicxml', data)

    expect(entry).toMatchObject({ filename: 'clair-de-lune.musicxml', sizeBytes: data.byteLength })
    const file = scoreFilePath(dataDir, entry)
    expect(file).not.toBeNull()
    expect(readFileSync(file as string)).toEqual(data)
    expect(readCatalog(dataDir)).toHaveLength(1)
    expect(findEntry(dataDir, entry.id)?.id).toBe(entry.id)
  })

  it('names the score after its MusicXML metadata rather than the file name', async () => {
    const entry = await addScore(dataDir, 'tchaikovsky-album-for-the-young-4-mama.musicxml', Buffer.from(SCORE_WITH_METADATA))
    expect(entry.title).toBe('Album for the Young')
    expect(entry.composer).toBe('Pyotr Ilyich Tchaikovsky')
  })

  it('falls back to a readable form of the file name when there is no metadata', async () => {
    const entry = await addScore(dataDir, 'bach-chorale-bwv-514.musicxml', Buffer.from(SCORE_WITHOUT_METADATA))
    expect(entry.title).toBe('Bach Chorale Bwv 514')
    expect(entry.composer).toBeNull()
  })

  it('keeps previously added scores', async () => {
    await addScore(dataDir, 'first.mxl', Buffer.from('a'))
    await addScore(dataDir, 'second.mxl', Buffer.from('b'))
    expect(readCatalog(dataDir).map((item) => item.filename).sort()).toEqual(['first.mxl', 'second.mxl'])
  })

  it('names the stored file after the generated id, never after the upload', async () => {
    // A traversal attempt in the file name must not escape the scores folder.
    const entry = await addScore(dataDir, '../../evil.xml', Buffer.from('x'))
    expect(entry.filename).toBe('evil.xml')
    const file = scoreFilePath(dataDir, entry) as string
    expect(file.startsWith(path.join(dataDir, 'scores') + path.sep)).toBe(true)
    expect(path.basename(file)).toBe(`${entry.id}.xml`)
  })

  it('rejects an unsupported file type', async () => {
    await expect(addScore(dataDir, 'notes.pdf', Buffer.from('x'))).rejects.toThrow(/Unsupported file type/)
  })
})

describe('titleFromFilename', () => {
  it('turns a slug into a readable title', () => {
    expect(titleFromFilename('persona-5-piano-the-days.mxl')).toBe('Persona 5 Piano the Days')
    expect(titleFromFilename('andreas_waldetoft_faster_than_light.xml')).toBe('Andreas Waldetoft Faster Than Light')
  })

  it('leaves a name that is already written out alone', () => {
    expect(titleFromFilename('Clair de Lune.musicxml')).toBe('Clair de Lune')
  })

  it('preserves deliberate casing', () => {
    expect(titleFromFilename('bach-BWV-514.xml')).toBe('Bach BWV 514')
  })

  it('falls back to the raw name when stripping leaves nothing', () => {
    expect(titleFromFilename('.mxl')).toBe('.mxl')
  })
})

describe('migrateCatalog', () => {
  it('backfills title and composer for entries saved before metadata extraction', async () => {
    const entry = await addScore(dataDir, 'tchaikovsky-album.musicxml', Buffer.from(SCORE_WITH_METADATA))
    // Rewrite the catalog in its pre-metadata shape.
    writeFileSync(
      path.join(dataDir, 'catalog.json'),
      JSON.stringify([
        {
          id: entry.id,
          title: 'tchaikovsky-album',
          filename: entry.filename,
          sizeBytes: entry.sizeBytes,
          uploadedAt: entry.uploadedAt,
        },
      ]),
      'utf8',
    )

    await migrateCatalog(dataDir)

    expect(readCatalog(dataDir)[0]).toMatchObject({
      title: 'Album for the Young',
      composer: 'Pyotr Ilyich Tchaikovsky',
    })
  })

  it('leaves an already-migrated catalog untouched', async () => {
    await addScore(dataDir, 'first.musicxml', Buffer.from(SCORE_WITH_METADATA))
    const before = readFileSync(path.join(dataDir, 'catalog.json'), 'utf8')
    await migrateCatalog(dataDir)
    expect(readFileSync(path.join(dataDir, 'catalog.json'), 'utf8')).toBe(before)
  })

  it('still migrates the other entries when a score file went missing', async () => {
    const entry = await addScore(dataDir, 'tchaikovsky-album.musicxml', Buffer.from(SCORE_WITH_METADATA))
    writeFileSync(
      path.join(dataDir, 'catalog.json'),
      JSON.stringify([
        { id: entry.id, title: 'a', filename: entry.filename, sizeBytes: 1, uploadedAt: entry.uploadedAt },
        { id: entry.id.replace(/.$/, '0'), title: 'gone', filename: 'gone.mxl', sizeBytes: 1, uploadedAt: entry.uploadedAt },
      ]),
      'utf8',
    )

    await migrateCatalog(dataDir)

    const entries = readCatalog(dataDir)
    expect(entries[0].title).toBe('Album for the Young')
    // The orphaned entry keeps its title but is marked as migrated, so it isn't
    // re-read from disk on every restart.
    expect(entries[1]).toMatchObject({ title: 'gone', composer: null })
  })
})

describe('findEntry', () => {
  it('ignores an id that is not one we generated', async () => {
    await addScore(dataDir, 'first.mxl', Buffer.from('a'))
    expect(findEntry(dataDir, '../../../etc/passwd')).toBeNull()
    expect(findEntry(dataDir, 'not-a-uuid')).toBeNull()
  })
})

describe('readCatalog', () => {
  it('treats a missing catalog as empty', () => {
    expect(readCatalog(dataDir)).toEqual([])
  })

  it('throws on a corrupt catalog rather than silently dropping every entry', () => {
    writeFileSync(path.join(dataDir, 'catalog.json'), '{ not json', 'utf8')
    expect(() => readCatalog(dataDir)).toThrow()
  })
})

describe('extensionOf', () => {
  it('accepts the MusicXML extensions case-insensitively', () => {
    expect(extensionOf('Score.MXL')).toBe('.mxl')
    expect(extensionOf('score.musicxml')).toBe('.musicxml')
    expect(extensionOf('score.txt')).toBeNull()
  })
})

describe('resolveDataDir', () => {
  it('honours PIANO_TRAINER_DATA_DIR', () => {
    const previous = process.env.PIANO_TRAINER_DATA_DIR
    process.env.PIANO_TRAINER_DATA_DIR = dataDir
    try {
      expect(resolveDataDir()).toBe(path.resolve(dataDir))
    } finally {
      if (previous === undefined) {
        delete process.env.PIANO_TRAINER_DATA_DIR
      } else {
        process.env.PIANO_TRAINER_DATA_DIR = previous
      }
    }
  })
})
