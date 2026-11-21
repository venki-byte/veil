/**
 * Strict mode: the cloud never sees the document, not even redacted.
 *
 *   1. On-device: Gemini Nano picks the kind of document from a fixed list.
 *   2. Cloud: sees only that label and writes questions to ask.
 *   3. On-device: Gemini Nano answers the questions from the document,
 *      chunk by chunk.
 *   4. Cloud: writes the explanation from the short, redacted answers.
 *
 * This follows the "Minions" finding that a cloud model which splits work
 * into small local subtasks recovers most of the quality of sending the
 * whole document.
 *
 * This file is plain code. The four model calls are passed in, so the flow
 * is unit tested with fakes; the app passes the task functions from
 * hybrid.ts. Hard limits here bound what can reach the cloud:
 *   - the label is always one of DOCUMENT_TYPES, never free text,
 *   - at most MAX_QUESTIONS questions, each answer at most MAX_FACT_CHARS.
 */

import { chunkText, DEFAULT_CHUNK_CHARS } from '../privacy/chunk'
import type { Explanation } from './schemas'

export const DOCUMENT_TYPES = [
  'blood test or lab report',
  'medical report or discharge summary',
  'prescription or medical certificate',
  'rental or lease agreement',
  'loan document',
  'bank letter or statement',
  'tax notice or tax document',
  'insurance document',
  'employment letter or contract',
  'legal notice or court document',
  'bill or invoice',
  'other document',
] as const

export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const MAX_QUESTIONS = 10
export const MAX_QUESTION_CHARS = 200
/** Longest combined answer to one question that may be sent to the cloud. */
export const MAX_FACT_CHARS = 300
/** Most on-device calls spent re-asking unanswered questions one at a time. */
export const MAX_RETRY_CALLS = 12
/** How much of the document Gemini Nano reads to name its kind. */
export const CLASSIFY_EXCERPT_CHARS = 1500

export interface StrictQuestion {
  id: string
  question: string
}

export interface ChunkAnswer {
  id: string
  answer: string
}

/** One question with its merged answer. This is what the cloud receives. */
export interface StrictFact {
  id: string
  question: string
  answer: string
}

export class StrictModeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StrictModeError'
  }
}

/** Anything that is not exactly one of the fixed labels becomes "other document". */
export function cleanDocumentType(raw: unknown): DocumentType {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return DOCUMENT_TYPES.find((type) => type === value) ?? 'other document'
}

function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

/**
 * Checks the questions the cloud wrote before they are shown to the
 * on-device model: plain strings only, trimmed, de-duplicated and capped.
 */
export function cleanQuestions(raw: unknown): StrictQuestion[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { questions?: unknown }).questions)
      ? (raw as { questions: unknown[] }).questions
      : []

  const seen = new Set<string>()
  const questions: StrictQuestion[] = []
  for (const item of list) {
    const text =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof (item as { question?: unknown }).question === 'string'
          ? (item as { question: string }).question
          : ''
    const question = shorten(text.replace(/\s+/g, ' ').replace(/^(?:Q?\d+[.):]\s*|[-*•]\s*)/i, '').trim(), MAX_QUESTION_CHARS)
    const key = question.toLowerCase()
    if (question.length < 8 || seen.has(key)) continue
    seen.add(key)
    questions.push({ id: `Q${questions.length + 1}`, question })
    if (questions.length === MAX_QUESTIONS) break
  }
  return questions
}

const NOT_FOUND =
  /^(?:not\s+found|n\s*\/?\s*a|none|unknown|nil|no\s+(?:answer|information|data)|not\s+(?:mentioned|stated|specified|available|provided|given|applicable|in\s+(?:the\s+)?(?:excerpt|text|document)))\b[\s.!]*$/i

/** True for the ways a small model says "the excerpt does not say". */
export function isNotFound(answer: unknown): boolean {
  if (typeof answer !== 'string') return true
  const text = answer.trim().replace(/^["'“]+|["'”]+$/g, '')
  return text.length === 0 || NOT_FOUND.test(text)
}

/**
 * Merges per-chunk answers into one short fact per question.
 * Questions that no chunk could answer are dropped. Every answer passes
 * through `redact` again before it can be sent.
 */
export function mergeAnswers(
  questions: StrictQuestion[],
  perChunk: ChunkAnswer[][],
  redact: (text: string) => string,
): StrictFact[] {
  const facts: StrictFact[] = []
  for (const { id, question } of questions) {
    const seen = new Set<string>()
    const parts: string[] = []
    for (const answers of perChunk) {
      for (const candidate of answers) {
        if (!candidate || candidate.id !== id || isNotFound(candidate.answer)) continue
        const text = candidate.answer.replace(/\s+/g, ' ').trim()
        const key = text.toLowerCase().replace(/[\s.]+$/, '')
        if (seen.has(key)) continue
        seen.add(key)
        parts.push(text)
      }
    }
    if (parts.length === 0) continue
    facts.push({ id, question, answer: shorten(redact(parts.join('; ')), MAX_FACT_CHARS) })
  }
  return facts
}

export type StrictStep =
  | { step: 'classify' }
  | { step: 'plan'; documentType: DocumentType }
  | { step: 'answer'; documentType: DocumentType; questions: number; done: number; total: number }
  | { step: 'combine'; documentType: DocumentType; facts: number }

export interface StrictDeps {
  /** On-device. Returns a label for the kind of document. */
  classify: (excerpt: string) => Promise<unknown>
  /** Cloud. Receives only the label; returns questions. */
  plan: (documentType: DocumentType) => Promise<unknown>
  /** On-device. Answers the questions from one chunk of the document. */
  answer: (chunk: string, questions: StrictQuestion[]) => Promise<ChunkAnswer[]>
  /** Cloud. Receives only the label and the short answers. */
  combine: (documentType: DocumentType, facts: StrictFact[]) => Promise<Explanation>
  /** Replaces every hidden value with its placeholder. */
  redact: (text: string) => string
  onStep?: (step: StrictStep) => void
  maxChunkChars?: number
}

export interface StrictOutcome {
  documentType: DocumentType
  questions: StrictQuestion[]
  /** Exactly what the cloud was given in place of the document. */
  facts: StrictFact[]
  explanation: Explanation
  /** Chunks Gemini Nano could not answer from. */
  failedChunks: number
  /** On-device calls spent asking unanswered questions one at a time. */
  retryCalls: number
}

/**
 * Runs strict mode on a document that has already been redacted.
 * Gemini Nano reads the redacted text, so even its answers start from
 * placeholders rather than real values.
 */
export async function runStrict(redactedDocument: string, deps: StrictDeps): Promise<StrictOutcome> {
  deps.onStep?.({ step: 'classify' })
  const documentType = cleanDocumentType(await deps.classify(redactedDocument.slice(0, CLASSIFY_EXCERPT_CHARS)))

  deps.onStep?.({ step: 'plan', documentType })
  const questions = cleanQuestions(await deps.plan(documentType))
  if (questions.length === 0) {
    throw new StrictModeError('The cloud did not return usable questions. Please try strict mode again.')
  }

  const chunks = chunkText(redactedDocument, deps.maxChunkChars ?? DEFAULT_CHUNK_CHARS)
  const perChunk: ChunkAnswer[][] = []
  let failedChunks = 0
  deps.onStep?.({ step: 'answer', documentType, questions: questions.length, done: 0, total: chunks.length })
  for (let index = 0; index < chunks.length; index += 1) {
    try {
      perChunk.push(await deps.answer(chunks[index].text, questions))
    } catch {
      failedChunks += 1
    }
    deps.onStep?.({ step: 'answer', documentType, questions: questions.length, done: index + 1, total: chunks.length })
  }

  // Second round: a small model asked eight questions at once often answers
  // only a few. Ask each unanswered question on its own, chunk by chunk,
  // until it is answered or the call budget runs out.
  let facts = mergeAnswers(questions, perChunk, deps.redact)
  let retryCalls = 0
  const unanswered = questions.filter((question) => !facts.some((fact) => fact.id === question.id))
  for (const question of unanswered) {
    for (const chunk of chunks) {
      if (retryCalls >= MAX_RETRY_CALLS) break
      retryCalls += 1
      try {
        const replies = await deps.answer(chunk.text, [question])
        // Prefer the reply with this question's id. A single reply with
        // another id still belongs to the only question that was asked.
        const reply = replies.find((candidate) => candidate.id === question.id) ?? (replies.length === 1 ? replies[0] : undefined)
        perChunk.push([{ id: question.id, answer: reply?.answer ?? 'NOT FOUND' }])
        if (reply && !isNotFound(reply.answer)) break
      } catch {
        // A failed retry only means this question stays unanswered.
      }
    }
  }
  if (retryCalls > 0) facts = mergeAnswers(questions, perChunk, deps.redact)

  if (facts.length === 0) {
    throw new StrictModeError(
      'Gemini Nano could not answer any of the questions from this document, so there is nothing to explain in strict mode. The standard explanation sends the redacted text instead.',
    )
  }

  deps.onStep?.({ step: 'combine', documentType, facts: facts.length })
  const explanation = await deps.combine(documentType, facts)

  return { documentType, questions, facts, explanation, failedChunks, retryCalls }
}
