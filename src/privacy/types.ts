/**
 * Shared types for the privacy engine.
 *
 * Everything in src/privacy is plain, deterministic code. No model is ever
 * called from here, which is what makes it unit-testable and auditable.
 */

/** Types that Gemini Nano is asked to detect. Redacted by default. */
export const REDACT_TYPES = [
  'PERSON',
  'ORG',
  'ADDRESS',
  'ID',
  'DATE_OF_BIRTH',
  'CONTACT',
  'ACCOUNT',
  'OTHER',
] as const

/**
 * DATE covers dates that are not birth dates (due dates, report dates).
 * They are detected so the user can hide them, but stay visible by default
 * because the cloud needs them to explain deadlines.
 */
export const ALL_TYPES = [...REDACT_TYPES, 'DATE'] as const

export type SensitiveType = (typeof ALL_TYPES)[number]

/** Where a finding came from. */
export type SpanSource = 'regex' | 'nano' | 'manual'

/** A stretch of the original text that holds a personal detail. */
export interface Span {
  start: number
  end: number
  text: string
  type: SensitiveType
  source: SpanSource
}

export const TYPE_LABELS: Record<SensitiveType, string> = {
  PERSON: 'Person',
  ORG: 'Organisation',
  ADDRESS: 'Address',
  ID: 'ID number',
  DATE_OF_BIRTH: 'Date of birth',
  CONTACT: 'Contact',
  ACCOUNT: 'Account',
  OTHER: 'Other',
  DATE: 'Date',
}

export function isSensitiveType(value: unknown): value is SensitiveType {
  return typeof value === 'string' && (ALL_TYPES as readonly string[]).includes(value)
}

/** Types that are hidden unless the user chooses to show them. */
export function redactedByDefault(type: SensitiveType): boolean {
  return type !== 'DATE'
}
