import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addScore, extensionOf, findEntry, readCatalog, resolveDataDir, scoreFilePath } from './catalogStore.ts'

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'piano-trainer-catalog-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('addScore', () => {
  it('stores the bytes and makes them readable back through the catalog', () => {
    const data = Buffer.from('<score-partwise/>')
    const entry = addScore(dataDir, 'Clair de Lune.musicxml', data)

    expect(entry).toMatchObject({ title: 'Clair de Lune', filename: 'Clair de Lune.musicxml', sizeBytes: data.byteLength })
    const file = scoreFilePath(dataDir, entry)
    expect(file).not.toBeNull()
    expect(readFileSync(file as string)).toEqual(data)
    expect(readCatalog(dataDir)).toHaveLength(1)
    expect(findEntry(dataDir, entry.id)?.id).toBe(entry.id)
  })

  it('keeps previously added scores', () => {
    addScore(dataDir, 'first.mxl', Buffer.from('a'))
    addScore(dataDir, 'second.mxl', Buffer.from('b'))
    expect(readCatalog(dataDir).map((item) => item.filename).sort()).toEqual(['first.mxl', 'second.mxl'])
  })

  it('names the stored file after the generated id, never after the upload', () => {
    // A traversal attempt in the file name must not escape the scores folder.
    const entry = addScore(dataDir, '../../evil.xml', Buffer.from('x'))
    expect(entry.filename).toBe('evil.xml')
    const file = scoreFilePath(dataDir, entry) as string
    expect(file.startsWith(path.join(dataDir, 'scores') + path.sep)).toBe(true)
    expect(path.basename(file)).toBe(`${entry.id}.xml`)
  })

  it('rejects an unsupported file type', () => {
    expect(() => addScore(dataDir, 'notes.pdf', Buffer.from('x'))).toThrow(/Unsupported file type/)
  })
})

describe('findEntry', () => {
  it('ignores an id that is not one we generated', () => {
    addScore(dataDir, 'first.mxl', Buffer.from('a'))
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
