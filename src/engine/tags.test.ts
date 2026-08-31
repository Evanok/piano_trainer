import { describe, expect, it } from 'vitest'

import { buildTagTree, countTags, entryMatchesTag, normalizeTag, normalizeTags, tagMatches } from './tags'

describe('normalizeTag', () => {
  it('lowercases, trims and turns spaces into dashes', () => {
    expect(normalizeTag('  Jeux Video ')).toBe('jeux-video')
    expect(normalizeTag('Jeux-Video')).toBe('jeux-video')
    expect(normalizeTag('jeux    video')).toBe('jeux-video')
  })

  it('keeps accents, since a tag is also a label', () => {
    expect(normalizeTag('Study/Bartók')).toBe('study/bartók')
  })

  it('collapses separators and strips them from the ends', () => {
    expect(normalizeTag('/study//bartok/')).toBe('study/bartok')
    expect(normalizeTag('study / bartok')).toBe('study/bartok')
    expect(normalizeTag('--study--')).toBe('study')
  })

  it('drops punctuation that would only make a second spelling', () => {
    expect(normalizeTag('study: bartók!')).toBe('study-bartók')
  })

  it('answers null when nothing usable is left', () => {
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('///')).toBeNull()
    expect(normalizeTag('!!!')).toBeNull()
  })

  it('caps the length without leaving a trailing separator', () => {
    const tag = normalizeTag(`${'a'.repeat(59)}/b`)
    expect(tag).toBe('a'.repeat(59))
  })
})

describe('normalizeTags', () => {
  it('normalizes, de-duplicates and keeps the given order', () => {
    expect(normalizeTags(['Personal', 'study/Bartok', 'personal'])).toEqual(['personal', 'study/bartok'])
  })

  it('ignores anything that is not a usable string', () => {
    expect(normalizeTags(['ok', 42, null, '  ', {}])).toEqual(['ok'])
  })

  it('is empty for a non-array, so a malformed PATCH body clears nothing by accident', () => {
    expect(normalizeTags('personal')).toEqual([])
    expect(normalizeTags(undefined)).toEqual([])
  })

  it('caps how many tags one entry can carry', () => {
    const many = Array.from({ length: 40 }, (_, index) => `tag-${index}`)
    expect(normalizeTags(many)).toHaveLength(16)
  })
})

describe('tagMatches', () => {
  it('matches the tag itself and its descendants', () => {
    expect(tagMatches('study', 'study')).toBe(true)
    expect(tagMatches('study/bartok', 'study')).toBe(true)
    expect(tagMatches('study/bartok/mikrokosmos', 'study')).toBe(true)
  })

  it('does not match a sibling that merely shares a prefix', () => {
    expect(tagMatches('studying', 'study')).toBe(false)
    expect(tagMatches('study', 'study/bartok')).toBe(false)
  })

  it('reads an entry with no tags at all as no match', () => {
    expect(entryMatchesTag(undefined, 'personal')).toBe(false)
    expect(entryMatchesTag(['personal'], 'personal')).toBe(true)
  })
})

describe('countTags', () => {
  it('counts ancestors too', () => {
    const counts = countTags([{ tags: ['study/bartok'] }, { tags: ['study/czerny'] }, { tags: ['personal'] }])
    expect(counts).toEqual({ study: 2, 'study/bartok': 1, 'study/czerny': 1, personal: 1 })
  })

  it('counts an entry once per tag path, not once per child', () => {
    const counts = countTags([{ tags: ['study/bartok', 'study/czerny'] }])
    expect(counts.study).toBe(1)
  })

  it('ignores entries with no tags', () => {
    expect(countTags([{}, { tags: [] }])).toEqual({})
  })
})

describe('buildTagTree', () => {
  it('nests by path and sorts each level by name', () => {
    const tree = buildTagTree({ personal: 3, study: 2, 'study/czerny': 1, 'study/bartok': 1, 'beginner-1': 5 })
    expect(tree.map((node) => node.path)).toEqual(['beginner-1', 'personal', 'study'])
    const study = tree.find((node) => node.path === 'study')
    expect(study?.count).toBe(2)
    expect(study?.children.map((node) => node.name)).toEqual(['bartok', 'czerny'])
  })

  it('creates an intermediate level nothing carries directly, summing its children', () => {
    const tree = buildTagTree({ 'study/bartok': 2, 'study/czerny': 3 })
    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('study')
    expect(tree[0].count).toBe(5)
    expect(tree[0].children).toHaveLength(2)
  })

  it('is empty for an empty catalog', () => {
    expect(buildTagTree({})).toEqual([])
  })
})
