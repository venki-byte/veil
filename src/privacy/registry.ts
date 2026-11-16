/**
 * The registry maps each personal detail to a typed placeholder such as
 * [PERSON_1], and back again.
 *
 * It is plain code with no model involved: the same value always gets the
 * same placeholder, and putting values back is an exact lookup. It lives in
 * memory only and is never stored or sent anywhere.
 */

import { locateAll, overlaps } from './spans'
import {
  ALL_TYPES,
  redactedByDefault,
  type SensitiveType,
  type Span,
  type SpanSource,
} from './types'

export interface Entry {
  id: string
  /** The real value, exactly as first seen. */
  value: string
  type: SensitiveType
  /** What the cloud sees instead, e.g. "[PERSON_1]". */
  placeholder: string
  source: SpanSource
  /** When false the user has chosen to leave this value visible. */
  enabled: boolean
  /**
   * Parts of a person's name that are hidden under the same placeholder,
   * so "Mr. Iyer" is covered once "Ramesh Iyer" is known.
   */
  aliases: string[]
}

/** A piece of text, optionally tied to a registry entry. */
export interface Segment {
  text: string
  entry?: Entry
}

export interface Occurrence {
  start: number
  end: number
  entry: Entry
}

const NAME_PARTICLES = new Set(
  [
    'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'shri', 'smt', 'sri', 'kumari', 'late', 'sir',
    'the', 'and', 'von', 'van', 'der', 'den', 'bin', 'binti', 'del', 'des', 'dos', 'das',
    // Name parts that are also everyday words. Hiding them everywhere would
    // damage the text, so only the full name is replaced.
    'will', 'bill', 'may', 'mark', 'rose', 'grace', 'hope', 'faith', 'joy', 'art', 'rich', 'pat',
    'sue', 'don', 'rob', 'jan', 'june', 'april', 'august', 'summer', 'dawn', 'bank', 'park',
    'page', 'penny', 'frank', 'max', 'ray', 'guy', 'miles', 'major', 'king', 'prince', 'long',
    'young', 'white', 'black', 'brown', 'green', 'gray', 'grey', 'day', 'law', 'price', 'case',
  ],
)

const PLACEHOLDER_PATTERN = new RegExp(
  `\\[\\s*(${ALL_TYPES.join('|')})_(\\d+)\\s*\\]|(?<![\\w\\[])(${ALL_TYPES.join('|')})_(\\d+)(?!\\w)`,
  'gi',
)

const HONORIFIC = /^(?:(?:mr|mrs|ms|miss|mx|dr|prof|shri|smt|sri|kumari|late)\.?\s+)+/i

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Removes quotes, brackets and trailing punctuation around a value. */
function tidy(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.'"“”‘’()[\]{}<>-]+/, '')
    .replace(/[\s,;:'"“”‘’([{<>-]+$/, '')
    .replace(/[\s.]+$/, '')
    .trim()
}

function nameAliases(value: string): string[] {
  const parts = value
    .split(/\s+/)
    .map((part) => part.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter(Boolean)
  if (parts.length < 2) return []
  return parts.filter(
    (part) => part.length >= 3 && /^\p{Lu}/u.test(part) && !NAME_PARTICLES.has(part.toLowerCase()),
  )
}

export class Registry {
  private entries: Entry[] = []
  private counters = new Map<SensitiveType, number>()

  /** All entries, in the order they were added. */
  list(): Entry[] {
    return [...this.entries]
  }

  /** Entries that are currently being hidden. */
  active(): Entry[] {
    return this.entries.filter((entry) => entry.enabled)
  }

  get size(): number {
    return this.entries.length
  }

  find(value: string): Entry | undefined {
    const key = normalise(tidy(value))
    if (!key) return undefined
    return (
      this.entries.find((entry) => normalise(entry.value) === key) ??
      this.entries.find((entry) => entry.aliases.some((alias) => alias.toLowerCase() === key))
    )
  }

  byPlaceholder(placeholder: string): Entry | undefined {
    const key = placeholder.replace(/[\s[\]]/g, '').toUpperCase()
    return this.entries.find((entry) => entry.placeholder === `[${key}]`)
  }

  /**
   * Registers a value and returns its entry. The same value (ignoring case
   * and spacing) always returns the same entry and placeholder.
   * Returns null for values that are too short or too vague to hide safely.
   */
  add(rawValue: string, type: SensitiveType, source: SpanSource): Entry | null {
    let value = tidy(rawValue)
    // "Mrs. Meenakshi Raghavan" and "Meenakshi Raghavan" are the same person:
    // the title stays in the text and only the name is hidden.
    if (type === 'PERSON') value = tidy(value.replace(HONORIFIC, ''))
    if (value.length < 2 || value.length > 200) return null
    if (!/[\p{L}\p{N}]/u.test(value)) return null
    // Never register something that looks like one of our own placeholders.
    if (new RegExp(`^\\[?(?:${ALL_TYPES.join('|')})(?:_\\d+)?\\]?$`, 'i').test(value)) return null

    const existing = this.find(value)
    if (existing) {
      // A plain date that turns out to be a birth date is upgraded and hidden.
      if (existing.type === 'DATE' && type !== 'DATE') {
        existing.type = type
        existing.placeholder = this.nextPlaceholder(type)
        existing.enabled = true
        existing.source = source
      }
      return existing
    }

    const entry: Entry = {
      id: `e${this.entries.length + 1}`,
      value,
      type,
      placeholder: this.nextPlaceholder(type),
      source,
      enabled: redactedByDefault(type),
      aliases: type === 'PERSON' ? nameAliases(value) : [],
    }
    this.entries.push(entry)
    return entry
  }

  /** Registers every span found by detection. */
  addSpans(spans: Span[]): void {
    for (const span of spans) this.add(span.text, span.type, span.source)
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (entry) entry.enabled = enabled
  }

  private nextPlaceholder(type: SensitiveType): string {
    const next = (this.counters.get(type) ?? 0) + 1
    this.counters.set(type, next)
    return `[${type}_${next}]`
  }

  /**
   * Finds every place where a hidden value appears in `text`.
   * Longer values win where two overlap. Result is sorted and non-overlapping.
   */
  findOccurrences(text: string, includeDisabled = false): Occurrence[] {
    const candidates: Occurrence[] = []
    for (const entry of includeDisabled ? this.entries : this.active()) {
      for (const hit of locateAll(text, entry.value)) {
        candidates.push({ start: hit.start, end: hit.end, entry })
      }
      // Aliases are matched case-sensitively so a surname such as "Rao"
      // does not swallow an ordinary lowercase word.
      for (const alias of entry.aliases) {
        for (const hit of locateAll(text, alias, true)) {
          candidates.push({ start: hit.start, end: hit.end, entry })
        }
      }
    }

    candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
    const accepted: Occurrence[] = []
    for (const candidate of candidates) {
      if (!accepted.some((kept) => overlaps(kept, candidate))) accepted.push(candidate)
    }
    return accepted.sort((a, b) => a.start - b.start)
  }

  /** Splits `text` into plain pieces and pieces that hold a hidden value. */
  segments(text: string, includeDisabled = false): Segment[] {
    const segments: Segment[] = []
    let cursor = 0
    for (const occurrence of this.findOccurrences(text, includeDisabled)) {
      if (occurrence.start > cursor) segments.push({ text: text.slice(cursor, occurrence.start) })
      segments.push({ text: text.slice(occurrence.start, occurrence.end), entry: occurrence.entry })
      cursor = occurrence.end
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) })
    return segments
  }

  /** Replaces every hidden value in `text` with its placeholder. */
  redact(text: string): string {
    return this.segments(text)
      .map((segment) => (segment.entry ? segment.entry.placeholder : segment.text))
      .join('')
  }

  /**
   * Splits text that contains placeholders into plain pieces and pieces
   * that map back to an entry. Unknown placeholders are left as they are.
   */
  rehydrateSegments(text: string): Segment[] {
    const segments: Segment[] = []
    let cursor = 0
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      const type = match[1] ?? match[3]
      const number = match[2] ?? match[4]
      const entry = this.byPlaceholder(`[${type}_${number}]`)
      if (!entry) continue
      if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) })
      segments.push({ text: entry.value, entry })
      cursor = match.index + match[0].length
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) })
    return segments
  }

  /** Puts the real values back in place of placeholders. */
  rehydrate(text: string): string {
    return this.rehydrateSegments(text)
      .map((segment) => segment.text)
      .join('')
  }
}
