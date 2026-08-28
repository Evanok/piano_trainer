/**
 * Automatic difficulty grade for a score.
 *
 * A second, derived opinion that sits next to `CatalogEntry.difficulty`; it
 * never overwrites it. The manual field encodes things the model cannot see
 * (see `docs/auto-grade.md`), so a human answer always wins where there is one.
 *
 * The model is a gradient-boosted ensemble trained offline on the Piano
 * Syllabus dataset -- 7,901 pieces graded from real teaching syllabi (ABRSM,
 * RCM, Trinity). It predicts on that scale: 1 (beginner) to 8 (advanced), with
 * an average error of about 0.8 of a grade, so it is a bracket, not a verdict.
 */
import JSZip from 'jszip'
import model from './gradeModel.json' with { type: 'json' }
import { predictGrade, type GradeModel } from './lightgbm.ts'
import { parseMusicXmlNotes } from './musicXmlNotes.ts'
import { computeGradeFeatures, FEATURE_ORDER } from './gradeFeatures.ts'

const GRADE_MODEL = model as GradeModel

/** Bump when the features, the model or the parser change, so grades are re-derived. */
export const GRADE_VERSION = 1

/** A score needs some substance before a grade means anything at all. */
const MIN_NOTES = 16

export interface ScoreGrade {
  /** Continuous prediction on the 1-8 syllabus scale. */
  value: number
  gradeVersion: number
}

/** Grade a score already decoded to MusicXML text. Null when it cannot be graded. */
export function gradeFromXml(xml: string): ScoreGrade | null {
  const notes = parseMusicXmlNotes(xml)
  if (notes.length < MIN_NOTES) {
    return null
  }
  const features = computeGradeFeatures(notes)
  const [low, high] = GRADE_MODEL.clamp
  const raw = predictGrade(GRADE_MODEL, features)
  return {
    value: Math.round(Math.min(Math.max(raw, low), high) * 100) / 100,
    gradeVersion: GRADE_VERSION,
  }
}

/** Reads the score XML out of a compressed .mxl (a ZIP), or null if it can't. */
async function readCompressedXml(data: Uint8Array): Promise<string | null> {
  const zip = await JSZip.loadAsync(data)
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
 * Best-effort, exactly like `extractScoreMetadata`: an unreadable or
 * ungradeable file yields null instead of throwing, so nothing about grading
 * can make an upload fail.
 */
export async function estimateScoreGrade(filename: string, data: Uint8Array): Promise<ScoreGrade | null> {
  try {
    const xml = filename.toLowerCase().endsWith('.mxl')
      ? await readCompressedXml(data)
      : Buffer.from(data).toString('utf8')
    return xml ? gradeFromXml(xml) : null
  } catch {
    return null
  }
}

export { FEATURE_ORDER }
