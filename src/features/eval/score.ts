/**
 * Scoring for the leak test. Plain code, no model.
 *
 * A planted detail counts as hidden only if every letter and digit of every
 * place it appears in the document would be replaced by a placeholder. If any
 * part of it would still be visible to the cloud, it counts as leaked. This is
 * checked by position, so a detail cannot pass by accident.
 */

import { detectDocument, type NanoDetector } from '../../privacy/detect'
import { Registry } from '../../privacy/registry'
import { locateAll, overlaps } from '../../privacy/spans'
import type { Span } from '../../privacy/types'
import type { EvalDocument, Planted } from './corpus'

export interface DetailScore {
  planted: Planted
  /** How many times the detail (or a variant of it) appears in the document. */
  occurrences: number
  /** Letters and digits of the detail that would still be visible. */
  visibleChars: number
  totalChars: number
  hidden: boolean
}

export interface DocumentScore {
  planted: number
  hidden: number
  leaked: DetailScore[]
  /** Planted details that do not appear in the text at all: a corpus mistake. */
  missing: Planted[]
  /** Other things that were hidden but were not on the planted list. */
  extraHidden: number
}

const WORD_CHAR = /[\p{L}\p{N}]/u

type Range = { start: number; end: number }

/** Merges overlapping ranges so shared characters are counted once. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/**
 * Scores one document: given what detection found, which planted details
 * would still be visible in the text sent to the cloud?
 */
export function scoreDocument(text: string, planted: Planted[], spans: Span[]): DocumentScore {
  const registry = new Registry()
  registry.addSpans(spans)
  const redactedRanges = registry.findOccurrences(text)

  const covered = new Uint8Array(text.length)
  for (const range of redactedRanges) covered.fill(1, range.start, range.end)

  const leaked: DetailScore[] = []
  const missing: Planted[] = []
  const plantedRanges: Range[] = []
  let hidden = 0

  for (const detail of planted) {
    const forms = [detail.value, ...(detail.alsoWrittenAs ?? [])]
    const ranges = mergeRanges(forms.flatMap((form) => locateAll(text, form)))
    if (ranges.length === 0) {
      missing.push(detail)
      continue
    }
    plantedRanges.push(...ranges)

    let visibleChars = 0
    let totalChars = 0
    for (const range of ranges) {
      for (let index = range.start; index < range.end; index += 1) {
        if (!WORD_CHAR.test(text[index])) continue
        totalChars += 1
        if (!covered[index]) visibleChars += 1
      }
    }

    if (visibleChars === 0) hidden += 1
    else leaked.push({ planted: detail, occurrences: ranges.length, visibleChars, totalChars, hidden: false })
  }

  const extraHidden = redactedRanges.filter((range) => !plantedRanges.some((plantedRange) => overlaps(range, plantedRange))).length

  return { planted: planted.length - missing.length, hidden, leaked, missing, extraHidden }
}

/* -------------------------------------------------------------------------- */
/* Running the test                                                           */
/* -------------------------------------------------------------------------- */

export interface MethodResult {
  score: DocumentScore
  /** Time spent on detection for this document, in milliseconds. */
  ms: number
  /** Chunks where the on-device model failed. Always 0 for regex only. */
  failures: number
}

export interface EvalRow {
  id: string
  title: string
  planted: number
  regex: MethodResult
  /** Null when the on-device model was not available for the run. */
  nano: MethodResult | null
}

export interface RunOptions {
  /** The on-device detector. Leave out to test regex only. */
  nano?: NanoDetector
  onProgress?: (done: number, total: number, row: EvalRow) => void
  signal?: AbortSignal
  now?: () => number
  /** Applied to each document first, the same way the app prepares real documents. */
  prepare?: (text: string) => string
}

/** Runs every document through regex only and, if available, regex plus Nano. */
export async function runEval(corpus: EvalDocument[], options: RunOptions = {}): Promise<EvalRow[]> {
  const now = options.now ?? (() => performance.now())
  const rows: EvalRow[] = []

  for (const document of corpus) {
    if (options.signal?.aborted) break
    const text = options.prepare ? options.prepare(document.text) : document.text

    const regexStart = now()
    const regexResult = await detectDocument(text)
    const regex: MethodResult = {
      score: scoreDocument(text, document.planted, regexResult.spans),
      ms: now() - regexStart,
      failures: 0,
    }

    let nano: MethodResult | null = null
    if (options.nano) {
      const nanoStart = now()
      const nanoResult = await detectDocument(text, { nano: options.nano, signal: options.signal })
      nano = {
        score: scoreDocument(text, document.planted, nanoResult.spans),
        ms: now() - nanoStart,
        failures: nanoResult.nanoFailures,
      }
    }

    const row: EvalRow = { id: document.id, title: document.title, planted: regex.score.planted, regex, nano }
    rows.push(row)
    options.onProgress?.(rows.length, corpus.length, row)
  }

  return rows
}

/* -------------------------------------------------------------------------- */
/* Summary and report                                                         */
/* -------------------------------------------------------------------------- */

export interface MethodSummary {
  leaked: number
  /** Leaked details as a share of planted details, from 0 to 1. */
  leakRate: number
  msPerDocument: number
  extraHidden: number
  failures: number
}

export interface EvalSummary {
  documents: number
  planted: number
  regex: MethodSummary
  nano: MethodSummary | null
}

function summariseMethod(results: MethodResult[], planted: number): MethodSummary {
  const leaked = results.reduce((sum, result) => sum + result.score.leaked.length, 0)
  return {
    leaked,
    leakRate: planted === 0 ? 0 : leaked / planted,
    msPerDocument: results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.ms, 0) / results.length,
    extraHidden: results.reduce((sum, result) => sum + result.score.extraHidden, 0),
    failures: results.reduce((sum, result) => sum + result.failures, 0),
  }
}

export function summarise(rows: EvalRow[]): EvalSummary {
  const planted = rows.reduce((sum, row) => sum + row.planted, 0)
  const nanoResults = rows.map((row) => row.nano).filter((result): result is MethodResult => result !== null)
  return {
    documents: rows.length,
    planted,
    regex: summariseMethod(
      rows.map((row) => row.regex),
      planted,
    ),
    // Only report the model column if it ran on every document.
    nano: rows.length > 0 && nanoResults.length === rows.length ? summariseMethod(nanoResults, planted) : null,
  }
}

export const formatPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`

export function formatMs(ms: number): string {
  if (ms < 1) return '<1 ms'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** A Markdown table of the results, ready to paste into the README. */
export function toMarkdown(rows: EvalRow[]): string {
  const summary = summarise(rows)
  const withNano = summary.nano !== null
  const cell = (result: MethodResult | null) => (result ? `${result.score.leaked.length}` : 'n/a')

  const lines = [
    withNano
      ? '| Document | Planted details | Leaked: regex only | Leaked: regex + Gemini Nano | Time: regex + Nano |'
      : '| Document | Planted details | Leaked: regex only |',
    withNano ? '| --- | ---: | ---: | ---: | ---: |' : '| --- | ---: | ---: |',
  ]

  for (const row of rows) {
    lines.push(
      withNano
        ? `| ${row.title} | ${row.planted} | ${cell(row.regex)} | ${cell(row.nano)} | ${formatMs(row.nano!.ms)} |`
        : `| ${row.title} | ${row.planted} | ${cell(row.regex)} |`,
    )
  }

  lines.push(
    withNano
      ? `| **Total (${summary.documents} documents)** | **${summary.planted}** | **${summary.regex.leaked} (${formatPercent(summary.regex.leakRate)})** | **${summary.nano!.leaked} (${formatPercent(summary.nano!.leakRate)})** | **${formatMs(summary.nano!.msPerDocument)} per document** |`
      : `| **Total (${summary.documents} documents)** | **${summary.planted}** | **${summary.regex.leaked} (${formatPercent(summary.regex.leakRate)})** |`,
  )

  return lines.join('\n')
}
