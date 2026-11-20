import { useRef, useState } from 'react'
import { describeError, detectionPasses, refreshDeviceStatus, ROUTES, type DeviceState } from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { ModeChip } from '../../components/RoutingTable'
import { SourceBadge } from '../../components/SourceBadge'
import { firebaseConfigured } from '../../firebase'
import { TYPE_LABELS } from '../../privacy/types'
import { normaliseText } from '../ingest/readFile'
import { EVAL_CORPUS, type EvalDocument } from './corpus'
import { HELDOUT_CORPUS } from './heldout'
import { formatMs, formatPercent, runEval, summarise, toMarkdown, type EvalRow, type MethodResult, type MethodSummary } from './score'

type SetId = 'dev' | 'heldout'

const SETS: Array<{ id: SetId; title: string; note: string; corpus: EvalDocument[] }> = [
  {
    id: 'dev',
    title: 'Development set',
    note: 'Detection patterns were improved after seeing results on these documents, so read this number as optimistic.',
    corpus: EVAL_CORPUS,
  },
  {
    id: 'heldout',
    title: 'Held-out set',
    note: 'Written after the last change to detection, and never used to tune it. This is the honest number.',
    corpus: HELDOUT_CORPUS,
  },
]

const TOTAL_DOCUMENTS = SETS.reduce((sum, set) => sum + set.corpus.length, 0)
const PLANTED_TOTAL = SETS.reduce((sum, set) => sum + set.corpus.reduce((inner, document) => inner + document.planted.length, 0), 0)

function LeakCell({ result }: { result: MethodResult | null }) {
  if (!result) return <span className="text-stone-400">n/a</span>
  const leaked = result.score.leaked.length
  return (
    <span className={`font-semibold tabular-nums ${leaked === 0 ? 'text-device-700' : 'text-rose-700'}`}>
      {leaked}
      <span className="font-normal text-muted"> of {result.score.planted}</span>
    </span>
  )
}

function rate(method: MethodSummary | null): string {
  return method ? formatPercent(method.leakRate) : 'n/a'
}

function SetResults({ title, note, rows }: { title: string; note: string; rows: EvalRow[] }) {
  const summary = summarise(rows)
  const twoPasses = rows.some((row) => row.nanoPlus !== null)

  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="font-serif text-xl text-device-900">{title}</h2>
      <p className="mt-1 text-sm text-muted">{note}</p>

      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {[
          ['Regex only', rate(summary.regex), summary.regex, 'text-stone-900'],
          ['+ Gemini Nano, 1 pass', rate(summary.nano), summary.nano, 'text-device-700'],
          ['+ Gemini Nano, 2 passes', rate(summary.nanoPlus), summary.nanoPlus, 'text-device-700'],
        ].map(([label, value, method, tone]) => (
          <div key={label as string} className="rounded-xl border border-line bg-white p-4">
            <dt className="text-[11px] uppercase tracking-wide text-muted">{label as string}</dt>
            <dd className={`mt-1 font-serif text-3xl ${tone as string}`}>{value as string}</dd>
            <dd className="mt-1 text-xs text-muted">
              {method
                ? `${(method as MethodSummary).leaked} of ${summary.planted} planted details still visible. ${formatMs((method as MethodSummary).msPerDocument)} per document.`
                : 'Did not run.'}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">{title}: results per document</caption>
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Document</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Regex only</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">+ Nano, 1 pass</th>
              {twoPasses && <th scope="col" className="px-4 py-2.5 text-right font-medium">+ Nano, 2 passes</th>}
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const best = row.nanoPlus ?? row.nano ?? row.regex
              return (
                <tr key={row.id} className="align-top">
                  <th scope="row" className="px-4 py-3 font-normal">
                    <span className="font-medium text-stone-900">{row.title}</span>
                    {best.score.leaked.length > 0 && (
                      <span className="mt-1 block text-xs leading-relaxed text-rose-700">
                        Still visible:{' '}
                        {best.score.leaked.map((detail) => `${detail.planted.value} (${TYPE_LABELS[detail.planted.type]})`).join('; ')}
                      </span>
                    )}
                    {best.failures > 0 && (
                      <span className="mt-1 block text-xs text-amber-700">{best.failures} on-device call(s) failed on this document.</span>
                    )}
                  </th>
                  <td className="px-4 py-3 text-right"><LeakCell result={row.regex} /></td>
                  <td className="px-4 py-3 text-right"><LeakCell result={row.nano} /></td>
                  {twoPasses && <td className="px-4 py-3 text-right"><LeakCell result={row.nanoPlus} /></td>}
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    {row.nanoPlus ? formatMs(row.nanoPlus.ms) : row.nano ? formatMs(row.nano.ms) : 'n/a'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * The leak test: synthetic documents with planted personal details, run
 * through regex only and through regex plus Gemini Nano (one pass and two),
 * scored by plain code on whether each planted detail would have reached the
 * cloud.
 */
export function EvalPage({ device }: { device: DeviceState }) {
  const [results, setResults] = useState<Record<SetId, EvalRow[]>>({ dev: [], heldout: [] })
  const [running, setRunning] = useState(false)
  const [usedNano, setUsedNano] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const nanoReady = firebaseConfigured && device.status === 'ready'
  const done = results.dev.length + results.heldout.length
  const finished = !running && done === TOTAL_DOCUMENTS

  const markdown = () =>
    SETS.map((set) => `**${set.title}.** ${set.note}\n\n${toMarkdown(results[set.id])}`).join('\n\n')

  const run = async () => {
    const controller = new AbortController()
    abort.current = controller
    setResults({ dev: [], heldout: [] })
    setError(null)
    setCopied(false)
    setRunning(true)
    try {
      const current = firebaseConfigured ? await refreshDeviceStatus() : device
      const withNano = firebaseConfigured && current.status === 'ready'
      setUsedNano(withNano)
      for (const set of SETS) {
        await runEval(set.corpus, {
          nano: withNano ? detectionPasses() : undefined,
          signal: controller.signal,
          prepare: normaliseText,
          onProgress: (_done, _total, row) => setResults((existing) => ({ ...existing, [set.id]: [...existing[set.id], row] })),
        })
      }
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setRunning(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown())
      setCopied(true)
    } catch {
      setError('Could not copy. Select the table text below and copy it by hand.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <a href="#/" className="inline-flex items-center gap-1.5 text-sm font-medium text-device-700 hover:underline">
        <Icon name="arrowLeft" /> Back to Veil
      </a>
      <h1 className="mt-4 font-serif text-3xl text-device-900">Leak test</h1>
      <p className="mt-2 max-w-3xl leading-relaxed text-muted">
        Privacy claims should be measured. This page takes {TOTAL_DOCUMENTS} synthetic documents with {PLANTED_TOTAL} planted
        personal details and checks, by position, whether each one would have been replaced by a placeholder before anything
        was sent. A detail counts as leaked if any letter or digit of it would still be visible. It compares pattern matching
        alone with pattern matching plus Gemini Nano, reading each part once (one broad pass) or twice (a broad pass, then a
        narrow pass for people and organisations).
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {running ? (
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50"
          >
            <Icon name="close" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            className="inline-flex items-center gap-2 rounded-lg bg-device-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-device-900"
          >
            <Icon name="shieldCheck" /> {done > 0 ? 'Run again' : 'Run the leak test'}
          </button>
        )}
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <ModeChip mode={ROUTES.detect.mode} />
          <SourceBadge source="local_code" />
          Nothing in this test is sent to the cloud. With Gemini Nano it takes several minutes.
        </span>
      </div>

      {!nanoReady && !running && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm leading-relaxed text-amber-900">
          <Icon name="alert" className="mt-0.5 shrink-0" />
          {firebaseConfigured
            ? 'Gemini Nano is not ready in this browser, so only the regex column will be filled. Set up private mode on the home page to compare.'
            : 'Firebase is not configured, so only the regex column will be filled. Add your config to .env to compare.'}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800">
          <Icon name="alert" className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {running && (
        <div className="mt-5" role="status" aria-live="polite">
          <div
            role="progressbar"
            aria-label="Leak test progress"
            aria-valuemin={0}
            aria-valuemax={TOTAL_DOCUMENTS}
            aria-valuenow={done}
            className="h-2 overflow-hidden rounded-full bg-device-100"
          >
            <div
              className="h-full rounded-full bg-device-600 transition-[width] duration-300"
              style={{ width: `${Math.max((done / TOTAL_DOCUMENTS) * 100, 3)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Document {Math.min(done + 1, TOTAL_DOCUMENTS)} of {TOTAL_DOCUMENTS}
            {usedNano ? ': Gemini Nano is reading on this device. Keep this tab in front.' : ': checking patterns'}
          </p>
        </div>
      )}

      {SETS.map((set) => (results[set.id].length > 0 ? <SetResults key={set.id} title={set.title} note={set.note} rows={results[set.id]} /> : null))}

      {finished && (
        <section aria-labelledby="markdown-title" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="markdown-title" className="font-serif text-xl text-device-900">Results as Markdown</h2>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
            >
              <Icon name={copied ? 'check' : 'file'} /> {copied ? 'Copied' : 'Copy tables'}
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-white p-4 font-mono text-[11.5px] leading-relaxed text-stone-800">
            {markdown()}
          </pre>
        </section>
      )}

      <section aria-labelledby="corpus-title" className="mt-10">
        <h2 id="corpus-title" className="font-serif text-xl text-device-900">The test documents</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
          Every person, organisation, address and number below is invented. Open a document to see its text and the details
          planted in it.
        </p>
        {SETS.map((set) => (
          <div key={set.id} className="mt-4">
            <h3 className="text-sm font-semibold text-stone-800">{set.title}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {set.corpus.map((document) => (
                <li key={document.id}>
                  <details className="rounded-xl border border-line bg-white">
                    <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium">
                      {document.title}
                      <span className="text-xs font-normal text-muted">{document.planted.length} planted details</span>
                    </summary>
                    <div className="border-t border-line px-4 py-3">
                      <ul className="flex flex-wrap gap-1.5">
                        {document.planted.map((detail) => (
                          <li key={detail.value} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-stone-800">
                            <span className="text-muted">{TYPE_LABELS[detail.type]}:</span> {detail.value}
                          </li>
                        ))}
                      </ul>
                      <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-stone-700">
                        {normaliseText(document.text)}
                      </pre>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-muted">
        How to read this: the test measures detection, the first line of defence. In the app you also review the redacted text
        before sending. The leak guard cannot catch what was never detected, which is why this number matters. Twenty
        documents is a small sample; treat the result as an indication, not a guarantee.
      </p>
    </div>
  )
}
