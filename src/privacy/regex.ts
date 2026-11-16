/**
 * Deterministic detection of personal details with regular expressions.
 *
 * This runs first, on every document, in every browser. It catches details
 * that have a recognisable shape (emails, phone numbers, ID and account
 * numbers, dates) plus values that follow an obvious label ("Name: ...").
 * Gemini Nano then adds what has no fixed shape: names, organisations and
 * addresses inside running text.
 */

import { overlaps } from './spans'
import type { SensitiveType, Span } from './types'

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\\.?'

const DATE_PATTERNS: RegExp[] = [
  // 12/03/1985, 12-03-85, 12.03.1985
  /(?<![\d/.-])\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})(?![\d/-])/g,
  // 1985-03-12
  /(?<![\d/.-])\d{4}[/.-]\d{1,2}[/.-]\d{1,2}(?![\d/-])/g,
  // 12 March 1985, 12th Mar, 1985, 12-Mar-1985
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${MONTH},?[\\s-]+\\d{2,4}\\b`, 'gi'),
  // March 12, 1985
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'),
]

/** Words that mark the date after them as a date of birth. */
const BIRTH_CUE = /(?:d\.?\s?o\.?\s?b\.?|date\s+of\s+birth|birth\s*date|birthday|born(?:\s+on)?)\W{0,12}$/i

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

/** Fixed-shape identifiers. Checked before the generic patterns. */
const SHAPED: Array<{ pattern: RegExp; type: SensitiveType }> = [
  // US Social Security number
  { pattern: /(?<![\w-])\d{3}-\d{2}-\d{4}(?![\w-])/g, type: 'ID' },
  // India GSTIN
  { pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g, type: 'ID' },
  // India PAN
  { pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g, type: 'ID' },
  // India IFSC bank branch code
  { pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, type: 'ACCOUNT' },
  // (080) 2345 6789, (555) 123-4567
  { pattern: /\(\d{2,5}\)[ -]?\d{3,4}[ -]?\d{3,4}(?!\d)/g, type: 'CONTACT' },
]

/**
 * A run of 9 to 19 digits, optionally grouped with single spaces or hyphens.
 * Not preceded by a letter, digit, or a digit plus separator (so it cannot
 * start in the middle of a number) and not followed by a decimal part
 * (so "125000000.50" stays an amount).
 */
const DIGIT_RUN = /(?<!\w)(?<!\d[.,/-])\+?\d(?:[ -]?\d){8,18}(?!\w)(?![.,]\d)/g

/** Group shapes that identify a phone number, e.g. 98765 43210 is "5-5". */
const PHONE_SHAPES = new Set([
  '5-5',
  '3-3-4',
  '4-3-3',
  '3-4-4',
  '4-6',
  '4-7',
  '3-7',
  '3-8',
  '2-8',
  '2-4-4',
  '5-6',
  '4-3-4',
])

/** Letters-and-digits tokens such as MRN-4482719 or LN/2026/004512. */
const ID_SHAPED = /(?<![A-Za-z0-9])[A-Z0-9](?:[A-Z0-9]|[-/](?=[A-Z0-9])){5,23}(?![A-Za-z0-9])/g

/** Common codes that look like IDs but are not personal. */
const NOT_AN_ID = /^(?:FY|AY|ISO|IS|IEC|COVID|SARS|Q[1-4]|H[12]|HBA|HB|ICD|CPT|UTC|GMT|IST)[-/]?\d/

const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|prof|shri|smt|sri|kumari|km|er|adv|md|mohd|late)\.?\s+/i

/** Labels whose value on the same line is a person's name. */
const NAME_LABEL = new RegExp(
  '(?:^|[\\n|;])[ \\t]*(?:' +
    [
      "patient(?:'s)?(?:\\s+name)?",
      '(?:full\\s+|customer\\s+|employee\\s+|account\\s+holder(?:\'s)?\\s+|applicant(?:\'s)?\\s+|tenant(?:\'s)?\\s+|landlord(?:\'s)?\\s+|borrower(?:\'s)?\\s+|insured\\s+|nominee\\s+)?name',
      'tenant',
      'landlord',
      'lessor',
      'lessee',
      'licensor',
      'licensee',
      'borrower',
      'co-?borrower',
      'co-?applicant',
      'applicant',
      'guarantor',
      'nominee',
      'account\\s+holder',
      'witness(?:\\s*\\d)?',
      'ref(?:erred|erring)?\\.?\\s*(?:by|doctor|physician)',
      'consultant',
      'doctor',
      'physician',
      'pathologist',
      'attn\\.?',
      'attention',
    ].join('|') +
    ')[ \\t]*[:\\-][ \\t]*([^\\n|;]+)',
  'gi',
)

/** "Dear Mr. Sharma," at the start of a letter. */
const SALUTATION = /(?:^|\n)[ \t]*Dear[ \t]+([^\n,:]{2,60})[,:]/g

/** Salutations that do not name anyone. */
const GENERIC_SALUTATION = /^(?:sir|madam|sir\s*\/\s*madam|sir\s+or\s+madam|customer|valued\s+customer|applicant|member|tenant|taxpayer|patient|all|team|colleagues?)$/i

/** S/o, D/o, W/o, C/o followed by a name: common in Indian paperwork. */
const RELATION_OF = /\b[SDWC]\/[Oo]\.?[ \t]+((?:(?:Mr|Mrs|Ms|Dr|Shri|Smt|Late)\.?[ \t]+)?[A-Z][\p{L}.'-]*(?:[ \t]+[A-Z][\p{L}.'-]*){0,3})/gu

/** Labels whose value on the same line is a postal address. */
const ADDRESS_LABEL =
  /(?:^|\n)[ \t]*(?:(?:residential|permanent|correspondence|mailing|postal|property|premises|billing|home|office|registered)[ \t]+)?address[ \t]*[:-][ \t]*([^\n]+)/gi

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length
}

/** Classifies an unbroken run of digits. */
function classifySolidRun(digits: string): SensitiveType | null {
  if (digits.length < 9) return null
  if (digits.length === 10 && /^[6-9]/.test(digits)) return 'CONTACT'
  if (digits.length === 11 && digits.startsWith('0')) return 'CONTACT'
  if (digits.length === 12 && /^91[6-9]/.test(digits)) return 'CONTACT'
  return 'ACCOUNT'
}

/** Trims a labelled value down to the name or address itself. */
function cleanLabelledValue(raw: string, maxWords: number): { text: string; offset: number } | null {
  let offset = raw.length - raw.trimStart().length
  let text = raw.trim()

  // A value ends at a wide gap or tab: tables often put the next field there.
  const gap = text.search(/\t|\s{3,}/)
  if (gap > 0) text = text.slice(0, gap)

  const honorific = text.match(HONORIFIC)
  if (honorific) {
    offset += honorific[0].length
    text = text.slice(honorific[0].length)
  }

  text = text.replace(/[\s,.;:]+$/, '')
  // Stop at a comma, a bracket or a trailing label such as "Age: 42".
  const stop = text.search(/[,([{]|\s+(?:age|sex|gender|dob|date|id|no|ph|phone|mob|mobile|email)\b\.?\s*[:-]/i)
  if (stop > 0) text = text.slice(0, stop).replace(/[\s,.;:]+$/, '')

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > maxWords) return null
  if (text.length < 2) return null
  return { text, offset }
}

/**
 * Finds personal details with fixed patterns.
 * Returns non-overlapping spans, sorted by position.
 */
export function detectWithRegex(text: string): Span[] {
  const spans: Span[] = []

  const claim = (start: number, value: string, type: SensitiveType): boolean => {
    const span: Span = { start, end: start + value.length, text: value, type, source: 'regex' }
    if (span.end <= span.start) return false
    if (spans.some((kept) => overlaps(kept, span))) return false
    spans.push(span)
    return true
  }

  // 1. Emails.
  for (const match of text.matchAll(EMAIL)) {
    claim(match.index, match[0].replace(/[.]+$/, ''), 'CONTACT')
  }

  // 2. Dates. Claimed early so their digits are not mistaken for phone numbers.
  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const lineStart = text.lastIndexOf('\n', match.index) + 1
      const before = text.slice(Math.max(lineStart, match.index - 40), match.index)
      claim(match.index, match[0], BIRTH_CUE.test(before) ? 'DATE_OF_BIRTH' : 'DATE')
    }
  }

  // 3. Fixed-shape identifiers.
  for (const { pattern, type } of SHAPED) {
    for (const match of text.matchAll(pattern)) claim(match.index, match[0], type)
  }

  // 4. Long digit runs: phone numbers, account numbers, national IDs, cards.
  for (const match of text.matchAll(DIGIT_RUN)) {
    const value = match[0]
    const groups = value.replace(/^\+/, '').split(/[ -]/)

    if (groups.length === 1) {
      const type = value.startsWith('+') ? 'CONTACT' : classifySolidRun(groups[0])
      if (type) claim(match.index, value, type)
      continue
    }

    const shape = groups.map((group) => group.length).join('-')
    const digits = digitCount(value)

    if (value.startsWith('+') && digits >= 10 && digits <= 15) {
      claim(match.index, value, 'CONTACT')
    } else if (shape === '4-4-4') {
      claim(match.index, value, 'ID') // Aadhaar-style
    } else if (shape === '4-4-4-4' || shape === '4-6-5') {
      claim(match.index, value, 'ACCOUNT') // payment card
    } else if (PHONE_SHAPES.has(shape) && digits >= 10) {
      claim(match.index, value, 'CONTACT')
    } else {
      // Unrecognised grouping, e.g. a table row of numbers. Only keep the
      // groups that are long enough to be identifiers on their own.
      let cursor = match.index + (value.startsWith('+') ? 1 : 0)
      for (const group of groups) {
        const type = classifySolidRun(group)
        if (type) claim(cursor, group, type)
        cursor += group.length + 1
      }
    }
  }

  // 5. ID-shaped tokens that mix capital letters and digits.
  for (const match of text.matchAll(ID_SHAPED)) {
    const value = match[0]
    const letters = value.replace(/[^A-Z]/g, '').length
    if (letters >= 2 && digitCount(value) >= 4 && value.length >= 7 && !NOT_AN_ID.test(value)) {
      claim(match.index, value, 'ID')
    }
  }

  // 6. Values that follow a name label.
  for (const match of text.matchAll(NAME_LABEL)) {
    const raw = match[1]
    const rawStart = match.index + match[0].length - raw.length
    const cleaned = cleanLabelledValue(raw, 6)
    if (!cleaned) continue
    // A name starts with a capital letter and has no digits.
    if (!/^\p{Lu}/u.test(cleaned.text) || /\d/.test(cleaned.text)) continue
    claim(rawStart + cleaned.offset, cleaned.text, 'PERSON')
  }

  for (const match of text.matchAll(SALUTATION)) {
    const raw = match[1]
    const rawStart = match.index + match[0].length - 1 - raw.length
    const cleaned = cleanLabelledValue(raw, 5)
    if (!cleaned || GENERIC_SALUTATION.test(cleaned.text)) continue
    if (!/^\p{Lu}/u.test(cleaned.text) || /\d/.test(cleaned.text)) continue
    claim(rawStart + cleaned.offset, cleaned.text, 'PERSON')
  }

  for (const match of text.matchAll(RELATION_OF)) {
    const raw = match[1]
    const rawStart = match.index + match[0].length - raw.length
    const honorific = raw.match(HONORIFIC)
    const skip = honorific ? honorific[0].length : 0
    const value = raw.slice(skip).replace(/[\s,.;:]+$/, '')
    if (value.length >= 2) claim(rawStart + skip, value, 'PERSON')
  }

  // 7. Values that follow an address label.
  for (const match of text.matchAll(ADDRESS_LABEL)) {
    const raw = match[1]
    const rawStart = match.index + match[0].length - raw.length
    const offset = raw.length - raw.trimStart().length
    const value = raw.trim().replace(/[\s,.;:]+$/, '')
    if (value.length < 6) continue
    // An address span may contain a PIN code or phone that was claimed above.
    // Drop those inner claims: the whole address is hidden as one unit.
    const span: Span = {
      start: rawStart + offset,
      end: rawStart + offset + value.length,
      text: value,
      type: 'ADDRESS',
      source: 'regex',
    }
    for (let index = spans.length - 1; index >= 0; index -= 1) {
      const kept = spans[index]
      if (kept.start >= span.start && kept.end <= span.end) spans.splice(index, 1)
    }
    if (!spans.some((kept) => overlaps(kept, span))) spans.push(span)
  }

  return spans.sort((a, b) => a.start - b.start)
}
