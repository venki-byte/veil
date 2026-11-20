/**
 * Runs the full set of diagnostic checks and returns one outcome per check.
 *
 * The model calls are passed in as functions, so this file is plain code and
 * is unit tested with fakes. The Routing page passes the real task functions
 * from src/ai/hybrid.ts.
 */

import { expectedSource, type CheckOutcome, type SourceName } from './report'

export const ROUTE_MODES = ['only_on_device', 'prefer_on_device', 'prefer_in_cloud', 'only_in_cloud'] as const

/** An invented snippet with a name in it, to test on-device detection. */
export const DETECTION_SAMPLE = 'Patient Asha Verma, living at 4 Hill Road, Pune, was seen by Dr. Rohan Mehta on 3 March.'

/** An invented, already-redacted snippet, to test the cloud explanation. */
export const EXPLAIN_SAMPLE =
  'Kind of document: loan sanction letter.\n' +
  '[PERSON_1] has been sanctioned a loan of Rs. 5,00,000 for 24 months at 9% per annum. ' +
  'The EMI is Rs. 22,844, due on the 5th of every month. A late fee of Rs. 500 applies after the 5th. ' +
  'Prepayment is allowed after 6 months with a 2% charge. Contact [CONTACT_1] with questions.'

export interface DiagnosticDeps {
  routeCheck: (mode: string) => Promise<{ source: SourceName; durationMs: number; value: string }>
  detect: (chunk: string) => Promise<Array<{ text: string; type: string }>>
  explain: (redacted: string) => Promise<{
    source: SourceName
    durationMs: number
    value: { documentType: string; summary: string; keyTerms: unknown[]; thingsToWatch: unknown[]; deadlinesAndAmounts: unknown[]; questionsToAsk: unknown[] }
  }>
  leakDemo: () => Promise<void>
  isLeakBlocked: (error: unknown) => boolean
  describeError: (error: unknown) => string
  deviceReady: () => boolean
  online: () => boolean
  now?: () => number
  onProgress?: (done: number, total: number, title: string) => void
}

const SOURCE_LABEL: Record<SourceName, string> = { on_device: 'ON_DEVICE', in_cloud: 'IN_CLOUD' }

const preview = (text: string, limit = 100) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export async function runDiagnostics(deps: DiagnosticDeps): Promise<CheckOutcome[]> {
  const now = deps.now ?? (() => performance.now())
  const total = ROUTE_MODES.length + 3
  const outcomes: CheckOutcome[] = []

  const record = (outcome: CheckOutcome) => {
    outcomes.push(outcome)
    deps.onProgress?.(outcomes.length, total, outcome.title)
  }

  // 1 to 4: one call in each inference mode.
  for (const mode of ROUTE_MODES) {
    const title = `Routing: ${mode.toUpperCase()}`
    const expected = expectedSource(mode, deps.deviceReady(), deps.online())
    const expectedText = expected === 'error' ? 'a clear refusal (the model or connection it needs is missing)' : SOURCE_LABEL[expected]
    const started = now()
    try {
      const result = await deps.routeCheck(mode)
      const ok = expected === result.source
      record({
        title,
        expected: expectedText,
        status: ok ? 'pass' : 'fail',
        detail: `ran ${SOURCE_LABEL[result.source]}; replied "${preview(result.value, 80)}"`,
        ms: result.durationMs,
      })
    } catch (error) {
      record({
        title,
        expected: expectedText,
        status: expected === 'error' ? 'pass' : 'error',
        detail: `${expected === 'error' ? 'refused as expected: ' : ''}${deps.describeError(error)}`,
        ms: now() - started,
      })
    }
  }

  // 5: structured output on-device (the detection path).
  {
    const title = 'Structured output on-device (personal detail detection)'
    const expected = 'ON_DEVICE, and it finds the name "Asha Verma"'
    const started = now()
    if (!deps.deviceReady()) {
      record({ title, expected, status: 'fail', detail: 'skipped: Gemini Nano is not ready.', ms: 0 })
    } else {
      try {
        const findings = await deps.detect(DETECTION_SAMPLE)
        const foundName = findings.some((finding) => /asha|verma/i.test(finding.text))
        record({
          title,
          expected,
          status: foundName ? 'pass' : 'fail',
          detail: findings.length
            ? `found ${findings.length}: ${findings.map((finding) => `"${finding.text}" (${finding.type || 'no type'})`).join(', ')}`
            : 'found nothing in a sentence that contains a name and an address',
          ms: now() - started,
        })
      } catch (error) {
        record({ title, expected, status: 'error', detail: deps.describeError(error), ms: now() - started })
      }
    }
  }

  // 6: structured output in the cloud (the explanation path).
  {
    const title = 'Structured output in the cloud (explanation)'
    const expected = 'IN_CLOUD, with a summary and the other parts filled in'
    const started = now()
    if (!deps.online()) {
      record({ title, expected, status: 'fail', detail: 'skipped: offline.', ms: 0 })
    } else {
      try {
        const result = await deps.explain(EXPLAIN_SAMPLE)
        const explanation = result.value
        const ok = result.source === 'in_cloud' && explanation.summary.length > 20
        record({
          title,
          expected,
          status: ok ? 'pass' : 'fail',
          detail:
            `ran ${SOURCE_LABEL[result.source]}; type "${preview(explanation.documentType, 50)}"; ` +
            `summary ${explanation.summary.length} chars; ${explanation.keyTerms.length} key terms, ` +
            `${explanation.thingsToWatch.length} things to watch, ${explanation.deadlinesAndAmounts.length} amounts, ` +
            `${explanation.questionsToAsk.length} questions. Summary: "${preview(explanation.summary, 140)}"`,
          ms: result.durationMs,
        })
      } catch (error) {
        record({ title, expected, status: 'error', detail: deps.describeError(error), ms: now() - started })
      }
    }
  }

  // 7: the leak guard must refuse a planted value.
  {
    const title = 'Leak guard blocks a planted value'
    const expected = 'the request is refused before anything is sent'
    const started = now()
    try {
      await deps.leakDemo()
      record({ title, expected, status: 'fail', detail: 'the planted value was NOT blocked.', ms: now() - started })
    } catch (error) {
      record({
        title,
        expected,
        status: deps.isLeakBlocked(error) ? 'pass' : 'error',
        detail: deps.isLeakBlocked(error) ? 'blocked as expected; nothing was sent.' : deps.describeError(error),
        ms: now() - started,
      })
    }
  }

  return outcomes
}
