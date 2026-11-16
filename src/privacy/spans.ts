import type { Span, SpanSource } from './types'

/** Escapes a string for use inside a regular expression. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * Builds a pattern that finds `value` in running text.
 *
 * - Runs of whitespace in the value match any whitespace, so a name that is
 *   broken across two lines is still found.
 * - If the value starts or ends with a letter or digit, it must not be glued
 *   to another letter or digit. "Anand" does not match inside "Anandapuram".
 */
export function valuePattern(value: string, caseSensitive = false): RegExp {
  const tokens = value.trim().split(/\s+/).map(escapeRegExp)
  const body = tokens.join('\\s+')
  const first = value.trim().charAt(0)
  const last = value.trim().slice(-1)
  const before = WORD_CHAR.test(first) ? '(?<![\\p{L}\\p{N}])' : ''
  const after = WORD_CHAR.test(last) ? '(?![\\p{L}\\p{N}\\p{M}])' : ''
  return new RegExp(before + body + after, caseSensitive ? 'gu' : 'giu')
}

/** Finds every occurrence of `needle` in `text`. */
export function locateAll(
  text: string,
  needle: string,
  caseSensitive = false,
): Array<{ start: number; end: number; text: string }> {
  if (!needle.trim()) return []
  const found: Array<{ start: number; end: number; text: string }> = []
  for (const match of text.matchAll(valuePattern(needle, caseSensitive))) {
    found.push({ start: match.index, end: match.index + match[0].length, text: match[0] })
  }
  return found
}

const SOURCE_RANK: Record<SpanSource, number> = { manual: 0, regex: 1, nano: 2 }

export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end
}

/**
 * Resolves overlapping findings into a clean, non-overlapping list.
 *
 * When two findings overlap, the winner is chosen in this order:
 *   1. A real personal detail beats a plain DATE (which is visible by default).
 *   2. The longer span wins, so "Asha Verma" beats "Asha".
 *   3. Manual beats regex beats Nano: deterministic sources are trusted more.
 *   4. The earlier span wins.
 */
export function mergeSpans(spans: Span[]): Span[] {
  const ranked = [...spans]
    .filter((span) => span.end > span.start)
    .sort((a, b) => {
      const dateA = a.type === 'DATE' ? 1 : 0
      const dateB = b.type === 'DATE' ? 1 : 0
      if (dateA !== dateB) return dateA - dateB
      const lengthDiff = b.end - b.start - (a.end - a.start)
      if (lengthDiff !== 0) return lengthDiff
      const sourceDiff = SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
      if (sourceDiff !== 0) return sourceDiff
      return a.start - b.start
    })

  const accepted: Span[] = []
  for (const span of ranked) {
    if (!accepted.some((kept) => overlaps(kept, span))) accepted.push(span)
  }
  return accepted.sort((a, b) => a.start - b.start)
}
