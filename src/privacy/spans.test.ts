import { describe, expect, it } from 'vitest'
import { locateAll, mergeSpans } from './spans'
import type { Span } from './types'

const span = (start: number, end: number, type: Span['type'], source: Span['source']): Span => ({
  start,
  end,
  text: 'x'.repeat(end - start),
  type,
  source,
})

describe('locateAll', () => {
  it('finds every occurrence, ignoring case', () => {
    const hits = locateAll('Asha paid. ASHA signed. asha left.', 'Asha')
    expect(hits.map((hit) => hit.start)).toEqual([0, 11, 24])
  })

  it('matches across line breaks and extra spaces', () => {
    const hits = locateAll('Signed by Meenakshi\n   Raghavan today', 'Meenakshi Raghavan')
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('Meenakshi\n   Raghavan')
  })

  it('does not match inside a longer word', () => {
    expect(locateAll('Anandapuram is a town', 'Anand')).toHaveLength(0)
    expect(locateAll('Mr. Anand, and Anand.', 'Anand')).toHaveLength(2)
  })

  it('handles values with special characters', () => {
    expect(locateAll('Ref LN/2026/(A+B) noted', 'LN/2026/(A+B)')).toHaveLength(1)
  })

  it('can match case-sensitively', () => {
    expect(locateAll('Rao met rao', 'Rao', true)).toHaveLength(1)
  })
})

describe('mergeSpans', () => {
  it('keeps spans that do not overlap, sorted by position', () => {
    const merged = mergeSpans([span(20, 25, 'ID', 'regex'), span(0, 5, 'PERSON', 'nano')])
    expect(merged.map((s) => s.start)).toEqual([0, 20])
  })

  it('prefers the longer span when two overlap', () => {
    const merged = mergeSpans([span(0, 4, 'PERSON', 'regex'), span(0, 10, 'PERSON', 'nano')])
    expect(merged).toHaveLength(1)
    expect(merged[0].end).toBe(10)
  })

  it('prefers regex over Nano for identical spans', () => {
    const merged = mergeSpans([span(3, 13, 'OTHER', 'nano'), span(3, 13, 'CONTACT', 'regex')])
    expect(merged).toEqual([span(3, 13, 'CONTACT', 'regex')])
  })

  it('prefers a manual span over everything of the same length', () => {
    const merged = mergeSpans([span(3, 13, 'CONTACT', 'regex'), span(3, 13, 'OTHER', 'manual')])
    expect(merged[0].source).toBe('manual')
  })

  it('lets a real personal detail beat a plain date, even a longer one', () => {
    const merged = mergeSpans([span(0, 10, 'DATE', 'regex'), span(0, 10, 'DATE_OF_BIRTH', 'nano')])
    expect(merged).toEqual([span(0, 10, 'DATE_OF_BIRTH', 'nano')])
  })

  it('resolves a chain of partial overlaps without leaving overlaps behind', () => {
    const merged = mergeSpans([
      span(0, 6, 'PERSON', 'nano'),
      span(4, 12, 'ADDRESS', 'nano'),
      span(10, 14, 'ID', 'regex'),
    ])
    for (let i = 1; i < merged.length; i += 1) {
      expect(merged[i].start).toBeGreaterThanOrEqual(merged[i - 1].end)
    }
    expect(merged.some((s) => s.type === 'ADDRESS')).toBe(true)
  })

  it('drops empty spans', () => {
    expect(mergeSpans([span(5, 5, 'ID', 'regex')])).toEqual([])
  })
})
