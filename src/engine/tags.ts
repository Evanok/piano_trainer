/**
 * Tags are the catalog's virtual folders, in the Visual-Studio-filter sense: a
 * view, never a location. A score keeps living at `data/scores/<uuid><ext>` and
 * carries a list of tags, so the same file can be reached through
 * `beginner-1` and through `study/bartok` without being stored twice.
 *
 * The hierarchy is *derived*, not stored: a tag is a path, `/` separates its
 * levels, and the tree is rebuilt from the strings every time. There is
 * deliberately no registry of known tags either -- the list of tags is the union
 * of the ones entries carry, which is also what the counts are computed from.
 * The cost is that a tag with no entries left disappears (so an empty tag cannot
 * be created in advance); the gain is that adding "jazz" or "video-game" later
 * is a text input plus a PATCH, with no schema, no table and no migration.
 *
 * Pure and DOM-free: the server normalizes and filters with it, the front-end
 * builds its tree with it, so the two can never disagree on what `study`
 * matches.
 */

/** Applied to a fresh upload, so a new score is never in no folder at all. */
export const DEFAULT_TAG = 'personal'

export const MAX_TAGS_PER_ENTRY = 16
export const MAX_TAG_LENGTH = 60

/**
 * One normalization pass at every write, because it is the one thing that is
 * genuinely painful to fix afterwards: without it `Jeux-Video`, `jeux video` and
 * `jeux-video ` are three different folders that then have to be merged by hand.
 * Accents are kept (`study/bartók` is a legitimate tag), case and spacing are
 * not.
 */
export function normalizeTag(raw: string): string | null {
  const collapsed = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    // Anything that is not a letter, a digit, a separator or a joiner would
    // only make two spellings of the same folder.
    .replace(/[^\p{L}\p{N}\-_/]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-/]+|[-/]+$/g, '')
    .replace(/-*\/-*/g, '/')
  if (!collapsed) {
    return null
  }
  return collapsed.length > MAX_TAG_LENGTH ? collapsed.slice(0, MAX_TAG_LENGTH).replace(/[-/]+$/, '') : collapsed
}

/**
 * Normalizes a whole list, dropping empties and duplicates and keeping the order
 * the caller gave. Accepts unknown because it also guards the PATCH body, where
 * the list arrives from the network.
 */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: string[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string') {
      continue
    }
    const tag = normalizeTag(candidate)
    if (tag !== null && !out.includes(tag)) {
      out.push(tag)
    }
    if (out.length >= MAX_TAGS_PER_ENTRY) {
      break
    }
  }
  return out
}

/**
 * Selecting a parent shows everything below it: `study` matches `study/bartok`,
 * which is what makes a one-field hierarchy worth having at all.
 */
export function tagMatches(tag: string, filter: string): boolean {
  return tag === filter || tag.startsWith(`${filter}/`)
}

export function entryMatchesTag(tags: string[] | undefined, filter: string): boolean {
  return (tags ?? []).some((tag) => tagMatches(tag, filter))
}

/** Every level of a path, so `study/bartok` also counts towards `study`. */
export function tagAncestry(tag: string): string[] {
  const parts = tag.split('/')
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
}

/**
 * How many entries sit under each tag, ancestors included. Counted per entry
 * through a Set, so a score tagged both `study/bartok` and `study/czerny`
 * counts once for `study` rather than twice.
 */
export function countTags(entries: Array<{ tags?: string[] }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    const paths = new Set<string>()
    for (const tag of entry.tags ?? []) {
      for (const path of tagAncestry(tag)) {
        paths.add(path)
      }
    }
    for (const path of paths) {
      counts[path] = (counts[path] ?? 0) + 1
    }
  }
  return counts
}

export interface TagNode {
  /** Full path, the value to filter on. */
  path: string
  /** Last segment, what the tree shows. */
  name: string
  /** Entries under this tag, its descendants included. */
  count: number
  children: TagNode[]
}

/**
 * Builds the tree the library screen renders from a flat count map. Intermediate
 * levels are created even when nothing carries them directly (a `study` node
 * exists as soon as `study/bartok` does), with the count they were given, or the
 * sum of their children when they are purely structural.
 */
export function buildTagTree(counts: Record<string, number>): TagNode[] {
  const nodes = new Map<string, TagNode>()
  const nodeFor = (path: string): TagNode => {
    const existing = nodes.get(path)
    if (existing) {
      return existing
    }
    const node: TagNode = { path, name: path.slice(path.lastIndexOf('/') + 1), count: counts[path] ?? 0, children: [] }
    nodes.set(path, node)
    const cut = path.lastIndexOf('/')
    if (cut === -1) {
      return node
    }
    nodeFor(path.slice(0, cut)).children.push(node)
    return node
  }

  const roots: TagNode[] = []
  for (const path of Object.keys(counts).sort()) {
    const node = nodeFor(path)
    if (!path.includes('/')) {
      roots.push(node)
    }
  }
  // A path can be created as somebody's parent before its own turn comes, so
  // collect the roots from the map rather than from the loop above alone.
  for (const [path, node] of nodes) {
    if (!path.includes('/') && !roots.includes(node)) {
      roots.push(node)
    }
  }

  const sortTree = (list: TagNode[]): TagNode[] => {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    for (const node of list) {
      sortTree(node.children)
      if (counts[node.path] === undefined && node.children.length > 0) {
        node.count = node.children.reduce((total, child) => total + child.count, 0)
      }
    }
    return list
  }
  return sortTree(roots)
}
