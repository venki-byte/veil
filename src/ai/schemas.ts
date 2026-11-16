/**
 * JSON Schemas for structured model output, plus tolerant parsers.
 *
 * The same plain JSON Schema object is used for both paths:
 *   - on-device as the Prompt API `responseConstraint`
 *   - in-cloud as Gemini `responseJsonSchema`
 * Parsers never trust the model: every field is checked and defaulted.
 */

import { REDACT_TYPES } from '../privacy/types'

export const detectionSchema = {
  type: 'object',
  properties: {
    spans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: [...REDACT_TYPES] },
        },
        required: ['text', 'type'],
        additionalProperties: false,
      },
    },
  },
  required: ['spans'],
  additionalProperties: false,
} as const

export const explanationSchema = {
  type: 'object',
  properties: {
    documentType: { type: 'string' },
    summary: { type: 'string' },
    keyTerms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, meaning: { type: 'string' } },
        required: ['term', 'meaning'],
      },
    },
    thingsToWatch: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
        required: ['title', 'detail'],
      },
    },
    deadlinesAndAmounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['label', 'value', 'note'],
      },
    },
    questionsToAsk: { type: 'array', items: { type: 'string' } },
  },
  required: ['documentType', 'summary', 'keyTerms', 'thingsToWatch', 'deadlinesAndAmounts', 'questionsToAsk'],
} as const

/**
 * The cloud `responseSchema` takes a subset of JSON Schema. Keywords it does
 * not know are removed here, so one schema definition serves both paths.
 */
const CLOUD_UNSUPPORTED = new Set(['additionalProperties', '$schema', '$id'])

export function toCloudSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toCloudSchema)
  if (!schema || typeof schema !== 'object') return schema
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !CLOUD_UNSUPPORTED.has(key))
      .map(([key, value]) => [key, toCloudSchema(value)]),
  )
}

export interface KeyTerm {
  term: string
  meaning: string
}

export interface WatchItem {
  title: string
  detail: string
}

export interface KeyFigure {
  label: string
  value: string
  note: string
}

/** A structured explanation. All text still contains placeholders. */
export interface Explanation {
  documentType: string
  summary: string
  keyTerms: KeyTerm[]
  thingsToWatch: WatchItem[]
  deadlinesAndAmounts: KeyFigure[]
  questionsToAsk: string[]
}

/** Pulls a JSON value out of model text, tolerating code fences and chatter. */
export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('The model did not return valid JSON.')
  }
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

export function parseDetection(text: string): Array<{ text: string; type: string }> {
  const root = asRecord(parseJson(text))
  return asArray(root.spans)
    .map((item) => ({ text: asString(asRecord(item).text), type: asString(asRecord(item).type) }))
    .filter((item) => item.text.length > 0)
}

export function parseExplanation(text: string): Explanation {
  const root = asRecord(parseJson(text))
  const explanation: Explanation = {
    documentType: asString(root.documentType) || 'Document',
    summary: asString(root.summary),
    keyTerms: asArray(root.keyTerms)
      .map((item) => ({ term: asString(asRecord(item).term), meaning: asString(asRecord(item).meaning) }))
      .filter((item) => item.term && item.meaning),
    thingsToWatch: asArray(root.thingsToWatch)
      .map((item) => ({ title: asString(asRecord(item).title), detail: asString(asRecord(item).detail) }))
      .filter((item) => item.title || item.detail),
    deadlinesAndAmounts: asArray(root.deadlinesAndAmounts)
      .map((item) => ({
        label: asString(asRecord(item).label),
        value: asString(asRecord(item).value),
        note: asString(asRecord(item).note),
      }))
      .filter((item) => item.label && item.value),
    questionsToAsk: asArray(root.questionsToAsk).map(asString).filter(Boolean),
  }
  if (!explanation.summary) throw new Error('The explanation came back empty. Please try again.')
  return explanation
}
