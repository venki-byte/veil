/**
 * End-to-end check on a whole sample document, as the app itself would run it:
 * detect, redact, explain, follow up, simplify, define, translate, quick read,
 * strict mode, the leak test with Gemini Nano, and a privacy audit of every
 * piece of text that was sent to the cloud.
 *
 * Plain code. The model calls are passed in, so this is unit tested with
 * fakes; the Routing page passes the real task functions from hybrid.ts.
 */

import { runStrict, type DocumentType, type StrictFact, type StrictQuestion, type ChunkAnswer } from '../ai/strict'
import type { Explanation } from '../ai/schemas'
import { EVAL_CORPUS } from '../features/eval/corpus'
import { formatMs, formatPercent, runEval, summarise, toMarkdown } from '../features/eval/score'
import { normaliseText } from '../features/ingest/readFile'
import { detectDocument, type NanoFinding } from '../privacy/detect'
import { findLeaks } from '../privacy/leakGuard'
import { Registry } from '../privacy/registry'
import type { CheckOutcome, SourceName } from './report'

export interface Timed<T> {
  value: T
  source: SourceName
  durationMs: number
}

export interface E2EDeps {
  sampleText: string
  /** Words from the sample that must not survive redaction. */
  mustBeHidden: string[]
  /** A fact from the sample that the follow-up answer should contain. */
  followUpExpect: string
  followUpQuestion: string
  term: string

  detectChunk: (chunk: string) => Promise<NanoFinding[]>
  explain: (redacted: string, registry: Registry) => Promise<Timed<Explanation>>
  followUp: (redactedDoc: string, redactedQuestion: string, registry: Registry) => Promise<Timed<string>>
  simplify: (text: string, registry: Registry) => Promise<Timed<string>>
  define: (term: string, context: string, registry: Registry) => Promise<Timed<string>>
  translate: (text: string, registry: Registry) => Promise<Timed<string>>
  quickRead: (redacted: string, registry: Registry) => Promise<Timed<string>>

  classify: (excerpt: string) => Promise<unknown>
  plan: (type: DocumentType, registry: Registry) => Promise<unknown>
  answerOnDevice: (chunk: string, questions: StrictQuestion[]) => Promise<ChunkAnswer[]>
  combine: (type: DocumentType, facts: StrictFact[], registry: Registry) => Promise<Explanation>
  followUpOnDevice: (redactedDoc: string, redactedQuestion: string) => Promise<Timed<string>>

  /** Position in the privacy ledger, so the audit covers only this run. */
  ledgerMark: () => number
  /** Text sent to the cloud since `mark`. */
  outboundSince: (mark: number) => string[]

  describeError: (error: unknown) => string
  now?: () => number
  onProgress?: (done: number, total: number, title: string) => void
}

export interface E2EResult {
  outcomes: CheckOutcome[]
  /** Markdown table of the leak test, for the README. Empty if it did not run. */
  appendix: string
}

export const E2E_TOTAL = 12

const preview = (text: string, limit = 90) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

const PLACEHOLDER = /\[[A-Z_]+_\d+\]/g
const DEVANAGARI = /[ऀ-ॿ]/

/** The explanation as plain text, for the light tasks. */
function asText(explanation: Explanation): string {
  return [explanation.summary, ...explanation.thingsToWatch.map((item) => `${item.title}: ${item.detail}`)].join('\n')
}

/** Every string in an explanation, joined. */
function everyString(explanation: Explanation): string {
  return JSON.stringify(explanation)
}

export async function runEndToEnd(deps: E2EDeps): Promise<E2EResult> {
  const now = deps.now ?? (() => performance.now())
  const outcomes: CheckOutcome[] = []
  const mark = deps.ledgerMark()
  let appendix = ''

  const record = (outcome: CheckOutcome) => {
    outcomes.push(outcome)
    deps.onProgress?.(outcomes.length, E2E_TOTAL, outcome.title)
  }

  /** Runs one check; a thrown error becomes an ERROR outcome instead of stopping the run. */
  const check = async (
    title: string,
    expected: string,
    body: () => Promise<{ status: CheckOutcome['status']; detail: string; ms?: number }>,
  ) => {
    const started = now()
    try {
      const result = await body()
      record({ title, expected, status: result.status, detail: result.detail, ms: result.ms ?? now() - started })
    } catch (error) {
      record({ title, expected, status: 'error', detail: deps.describeError(error), ms: now() - started })
    }
  }

  const skipped = (title: string, expected: string, why: string) =>
    record({ title, expected, status: 'fail', detail: `skipped: ${why}`, ms: 0 })

  const text = normaliseText(deps.sampleText)
  const registry = new Registry()
  let redacted = ''
  let explanation: Explanation | null = null

  // 1. Detect with Gemini Nano and build the registry.
  await check(
    'Detect and redact a whole document',
    `every name in the sample hidden (${deps.mustBeHidden.join(', ')})`,
    async () => {
      const result = await detectDocument(text, { nano: deps.detectChunk })
      registry.addSpans(result.spans)
      redacted = registry.redact(text)
      const survived = deps.mustBeHidden.filter((word) => redacted.toLowerCase().includes(word.toLowerCase()))
      return {
        status: survived.length === 0 && result.nanoFailures === 0 ? 'pass' : 'fail',
        detail:
          `${registry.active().length} details hidden (${result.nanoChunks} chunk(s) read by Gemini Nano, ${result.nanoFailures} failed)` +
          (survived.length ? `; STILL VISIBLE: ${survived.join(', ')}` : '; none of the planted names survive'),
      }
    },
  )

  // 2. The leak guard accepts the redacted text.
  await check('Leak guard passes the redacted text', 'no hidden value found in the outgoing text', async () => {
    const leaks = findLeaks(redacted, registry)
    return {
      status: leaks.length === 0 && redacted.length > 0 ? 'pass' : 'fail',
      detail: leaks.length ? `still present: ${leaks.map((leak) => leak.placeholder).join(', ')}` : `clean; ${redacted.length} characters would be sent`,
    }
  })

  // 3. Cloud explanation, then local rehydration.
  if (!redacted) {
    skipped('Explain the redacted document (cloud) and restore names', 'IN_CLOUD, no placeholders left over', 'detection did not produce text.')
  } else {
    await check('Explain the redacted document (cloud) and restore names', 'IN_CLOUD, no placeholders left over after restoring', async () => {
      const result = await deps.explain(redacted, registry)
      explanation = result.value
      const restored = registry.rehydrate(everyString(result.value))
      const left = [...new Set(restored.match(PLACEHOLDER) ?? [])]
      const usedPlaceholders = (everyString(result.value).match(PLACEHOLDER) ?? []).length
      return {
        status: result.source === 'in_cloud' && result.value.summary.length > 20 && left.length === 0 ? 'pass' : 'fail',
        detail:
          `ran ${result.source.toUpperCase()}; ${result.value.keyTerms.length} key terms, ${result.value.thingsToWatch.length} things to watch, ` +
          `${result.value.deadlinesAndAmounts.length} amounts; ${usedPlaceholders} placeholder(s) restored` +
          (left.length ? `; UNRESOLVED: ${left.join(', ')}` : '') +
          `. Summary: "${preview(registry.rehydrate(result.value.summary), 120)}"`,
        ms: result.durationMs,
      }
    })
  }

  const answerText = explanation ? asText(explanation) : ''

  // 4. Follow-up question.
  if (!redacted) {
    skipped('Follow-up question (cloud)', 'IN_CLOUD, answer mentions the right fact', 'no redacted text.')
  } else {
    await check('Follow-up question (cloud)', `IN_CLOUD, and the answer contains "${deps.followUpExpect}"`, async () => {
      const question = registry.redact(deps.followUpQuestion)
      const result = await deps.followUp(redacted, question, registry)
      const answer = registry.rehydrate(result.value)
      return {
        status: result.source === 'in_cloud' && answer.includes(deps.followUpExpect) ? 'pass' : 'fail',
        detail: `ran ${result.source.toUpperCase()}; answer: "${preview(answer, 160)}"`,
        ms: result.durationMs,
      }
    })
  }

  // 5 to 8. Light tasks.
  const needsAnswer = (title: string, expected: string) => skipped(title, expected, 'there is no explanation to work from.')

  if (!answerText) needsAnswer('Simpler words', 'ON_DEVICE')
  else {
    await check('Simpler words', 'ON_DEVICE, non-empty', async () => {
      const result = await deps.simplify(answerText, registry)
      return {
        status: result.source === 'on_device' && result.value.trim().length > 20 ? 'pass' : 'fail',
        detail: `ran ${result.source.toUpperCase()}; "${preview(registry.rehydrate(result.value), 120)}"`,
        ms: result.durationMs,
      }
    })
  }

  if (!answerText) needsAnswer(`Explain a term (${deps.term})`, 'ON_DEVICE')
  else {
    await check(`Explain a term (${deps.term})`, 'ON_DEVICE, non-empty', async () => {
      const result = await deps.define(deps.term, answerText, registry)
      return {
        status: result.source === 'on_device' && result.value.trim().length > 20 ? 'pass' : 'fail',
        detail: `ran ${result.source.toUpperCase()}; "${preview(result.value, 120)}"`,
        ms: result.durationMs,
      }
    })
  }

  if (!answerText) needsAnswer('Translate to Hindi', 'Hindi text (on-device if supported, otherwise IN_CLOUD)')
  else {
    await check('Translate to Hindi', 'Hindi text (on-device if supported, otherwise IN_CLOUD)', async () => {
      const result = await deps.translate(answerText, registry)
      return {
        status: DEVANAGARI.test(result.value) ? 'pass' : 'fail',
        detail: `ran ${result.source.toUpperCase()}; "${preview(result.value, 100)}"${DEVANAGARI.test(result.value) ? '' : ' (no Hindi characters in the answer)'}`,
        ms: result.durationMs,
      }
    })
  }

  if (!redacted) skipped('Quick read on this device', 'ON_DEVICE, non-empty', 'no redacted text.')
  else {
    await check('Quick read on this device', 'ON_DEVICE, non-empty', async () => {
      const result = await deps.quickRead(redacted, registry)
      return {
        status: result.source === 'on_device' && result.value.trim().length > 20 ? 'pass' : 'fail',
        detail: `ran ${result.source.toUpperCase()}; "${preview(registry.rehydrate(result.value), 140)}"`,
        ms: result.durationMs,
      }
    })
  }

  // 9. Strict mode, and 10. its on-device follow-up.
  let strictOk = false
  if (!redacted) {
    skipped('Strict mode', 'the cloud never receives the document', 'no redacted text.')
  } else {
    await check('Strict mode', 'a finished explanation built from short answers only', async () => {
      const outcome = await runStrict(redacted, {
        classify: deps.classify,
        plan: (type) => deps.plan(type, registry),
        answer: deps.answerOnDevice,
        combine: (type, facts) => deps.combine(type, facts, registry),
        redact: (value) => registry.redact(value),
      })
      strictOk = true
      return {
        status: outcome.explanation.summary.length > 20 ? 'pass' : 'fail',
        detail:
          `kind "${outcome.documentType}"; ${outcome.questions.length} questions; ${outcome.facts.length} answered ` +
          `(${outcome.failedChunks} chunk(s) failed). First answers: ${outcome.facts
            .slice(0, 3)
            .map((fact) => `"${preview(fact.answer, 50)}"`)
            .join(', ')}`,
      }
    })
  }

  if (!strictOk || !redacted) skipped('Follow-up after strict mode', 'ON_DEVICE', 'strict mode did not finish.')
  else {
    await check('Follow-up after strict mode', 'ON_DEVICE, non-empty', async () => {
      const result = await deps.followUpOnDevice(redacted, registry.redact(deps.followUpQuestion))
      return {
        status: result.source === 'on_device' && result.value.trim().length > 10 ? 'pass' : 'fail',
        detail: `ran ${result.source.toUpperCase()}; "${preview(registry.rehydrate(result.value), 140)}"`,
        ms: result.durationMs,
      }
    })
  }

  // 11. The leak test, with Gemini Nano, on the ten synthetic documents.
  await check('Leak test: 10 documents, regex versus regex + Gemini Nano', 'Nano leaks no more than regex alone', async () => {
    const rows = await runEval(EVAL_CORPUS, { nano: deps.detectChunk, prepare: normaliseText, now })
    const summary = summarise(rows)
    appendix = toMarkdown(rows)
    if (!summary.nano) return { status: 'fail', detail: 'Gemini Nano did not run on every document.' }
    const stillVisible = rows.flatMap((row) => (row.nano?.score.leaked ?? []).map((detail) => `${detail.planted.value}`))
    return {
      status: summary.nano.leaked <= summary.regex.leaked && summary.nano.failures === 0 ? 'pass' : 'fail',
      detail:
        `${summary.planted} planted details. Regex only leaked ${summary.regex.leaked} (${formatPercent(summary.regex.leakRate)}); ` +
        `regex + Nano leaked ${summary.nano.leaked} (${formatPercent(summary.nano.leakRate)}), ${formatMs(summary.nano.msPerDocument)} per document, ` +
        `${summary.nano.failures} chunk failure(s). Still visible with Nano: ${stillVisible.length ? stillVisible.join('; ') : 'none'}`,
    }
  })

  // 12. Audit: nothing that went to the cloud in this run contains a hidden value.
  await check('Privacy audit of everything sent to the cloud', 'no hidden value appears in any cloud request', async () => {
    const sent = deps.outboundSince(mark)
    const problems = sent.flatMap((outbound, index) =>
      findLeaks(outbound, registry).map((leak) => `request ${index + 1}: ${leak.placeholder} (${leak.via})`),
    )
    const chars = sent.reduce((sum, outbound) => sum + outbound.length, 0)
    return {
      status: sent.length > 0 && problems.length === 0 ? 'pass' : 'fail',
      detail:
        problems.length > 0
          ? `LEAKED: ${problems.join('; ')}`
          : `${sent.length} cloud request(s), ${chars.toLocaleString()} characters in total, checked against ${registry.active().length} hidden values: none found`,
    }
  })

  return { outcomes, appendix }
}
