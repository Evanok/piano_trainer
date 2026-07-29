import JSZip from 'jszip'

export interface ScoreMetadata {
  title: string | null
  composer: string | null
}

// A pathological file shouldn't be able to push a novel into the catalog list.
const MAX_FIELD_LENGTH = 200

function decodeEntities(text: string): string {
  return (
    text
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Last on purpose: decoding it first would turn "&amp;lt;" into "<".
      .replace(/&amp;/g, '&')
  )
}

function cleanField(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeEntities(raw)
    // MusicXML text elements are plain text, but be defensive about stray
    // markup rather than showing "<b>Title</b>" in the catalog.
    .replace(/<[^>]*>/g, '')
  // Only the first non-empty line: a multi-line title or creator is almost
  // always the same name repeated in another language or script (Tchaikovsky
  // scores carry the Cyrillic form on a second line), and joining them makes
  // for an unreadable catalog row.
  const text = (decoded.split(/\r?\n/).find((line) => line.trim() !== '') ?? '').replace(/\s+/g, ' ').trim()
  if (!text) {
    return null
  }
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH).trimEnd()}...` : text
}

function firstMatch(xml: string, pattern: RegExp): string | null {
  return cleanField(pattern.exec(xml)?.[1])
}

/**
 * Field extraction is done with targeted regexes rather than a full XML parse:
 * only three well-known, flat elements are needed, and Node has no built-in DOM
 * (pulling in an XML parser for `<work-title>` would be a lot of dependency for
 * very little).
 */
export function extractFromXml(xml: string): ScoreMetadata {
  const title =
    firstMatch(xml, /<work-title(?:\s[^>]*)?>([\s\S]*?)<\/work-title>/i) ??
    // Fallback for exports that only fill the movement (common on MuseScore
    // scores that were never given a work title).
    firstMatch(xml, /<movement-title(?:\s[^>]*)?>([\s\S]*?)<\/movement-title>/i)
  const composer = firstMatch(xml, /<creator\b[^>]*\btype\s*=\s*["']composer["'][^>]*>([\s\S]*?)<\/creator>/i)
  return { title, composer }
}

/** Reads the score XML out of a compressed .mxl (a ZIP), or null if it can't. */
async function readCompressedXml(data: Uint8Array): Promise<string | null> {
  const zip = await JSZip.loadAsync(data)
  // The MusicXML container spec points at the real score file; other entries
  // can be fonts, images, or a second "compressed" copy.
  const container = zip.file('META-INF/container.xml')
  if (container) {
    const rootPath = /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i.exec(await container.async('string'))?.[1]
    const rootEntry = rootPath ? zip.file(rootPath) : null
    if (rootEntry) {
      return rootEntry.async('string')
    }
  }
  const fallback = Object.values(zip.files).find(
    (file) => !file.dir && !file.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(file.name),
  )
  return fallback ? fallback.async('string') : null
}

/**
 * Best-effort: an unreadable or metadata-less file yields nulls rather than
 * throwing, so a score the app can still render is never rejected at upload
 * just because its header is odd.
 */
export async function extractScoreMetadata(filename: string, data: Uint8Array): Promise<ScoreMetadata> {
  try {
    const xml = filename.toLowerCase().endsWith('.mxl')
      ? await readCompressedXml(data)
      : Buffer.from(data).toString('utf8')
    return xml ? extractFromXml(xml) : { title: null, composer: null }
  } catch {
    return { title: null, composer: null }
  }
}
