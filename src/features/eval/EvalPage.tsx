import { useRef, useState } from 'react'
import { describeError, detectSensitive, refreshDeviceStatus, ROUTES, type DeviceState } from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { ModeChip } from '../../components/RoutingTable'
import { SourceBadge } from '../../components/SourceBadge'
import { firebaseConfigured } from '../../firebase'
import { TYPE_LABELS } from '../../privacy/types'
import { normaliseText } from '../ingest/readFile'
import { EVAL_CORPUS } from './corpus'
import { formatMs, formatPercent, runEval, summarise, toMarkdown, type EvalRow, type MethodResult } from './score'

const PLANTED_TOTAL = EVAL_CORPUS.reduce((sum, document) => sum + document.planted.length, 0)

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

function Stat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 font-serif text-3xl ${tone}`}>{value}</dd>
      <dd className="mt-1 text-xs leading-relaxed text-muted">{detail}</dd>
    </div>
  )
}

/**
 * The leak test: runs ten synthetic documents with planted personal details
 * through regex only and through regex plus Gemini Nano, and reports how many
 * planted details would still have been visible to the cloud.
 */
export function EvalPage({ device }: { device: DeviceState }) {
  const [rows, setRows] = useState<EvalRow[]>([])
  const [running, setRunning] = useState(false)
  const [usedNano, setUsedNano] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const nanoReady = firebaseConfigured && device.status === 'ready'
  const finished = !running && rows.length === EVAL_CORPUS.length
  const summary = summarise(rows)

  const run = async () => {
    const controller = new AbortController()
    abort.current = controller
    setRows([])
    setError(null)
    setCopied(false)
    setRunning(true)
    try {
      const current = firebaseConfigured ? await refreshDeviceStatus() : device
      const withNano = firebaseConfigured && current.status === 'ready'
      setUsedNano(withNano)
      await runEval(EVAL_CORPUS, {
        nano: withNano ? detectSensitive : undefined,
        signal: controller.signal,
        prepare: normaliseText,
        onProgress: (_done, _total, row) => setRows((existing) => [...existing, row]),
      })
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setRunning(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(rows))
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
        Privacy claims should be measured. This page takes {EVAL_CORPUS.length} synthetic documents with{' '}
        {PLANTED_TOTAL} planted personal details and checks, by position, whether each one would have been replaced
        by a placeholder before anything was sent. A detail counts as leaked if any letter or digit of it would
        still be visible. It compares pattern matching alone with pattern matching plus Gemini Nano.
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
            <Icon name="shieldCheck" /> {rows.length > 0 ? 'Run again' : 'Run the leak test'}
          </button>
        )}
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <ModeChip mode={ROUTES.detect.mode} />
          <SourceBadge source="local_code" />
          Nothing in this test is sent to the cloud.
        </span>
      </div>

      {!nanoReady && !running && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm leading-relaxed text-amber-900">
          <Icon name="alert" className="mt-0.5 shrink-0" />
          {firebaseConfigured
            ? 'Gemini Nano is not ready in this browser, so only the regex column will be filled. Set up private mode on the home page to compare both methods.'
            : 'Firebase is not configured, so only the regex column will be filled. Add your config to .env to compare both methods.'}
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
            aria-valuemax={EVAL_CORPUS.length}
            aria-valuenow={rows.length}
            className="h-2 overflow-hidden rounded-full bg-device-100"
          >
            <div
              className="h-full rounded-full bg-device-600 transition-[width] duration-300"
              style={{ width: `${Math.max((rows.length / EVAL_CORPUS.length) * 100, 3)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Document {Math.min(rows.length + 1, EVAL_CORPUS.length)} of {EVAL_CORPUS.length}
            {usedNano ? ': Gemini Nano is reading on this device' : ': checking patterns'}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Regex only"
              value={formatPercent(summary.regex.leakRate)}
              detail={`${summary.regex.leaked} of ${summary.planted} planted details still visible. ${formatMs(summary.regex.msPerDocument)} per document.`}
              tone="text-stone-900"
            />
            <Stat
              label="Regex + Gemini Nano"
              value={summary.nano ? formatPercent(summary.nano.leakRate) : 'n/a'}
              detail={
                summary.nano
                  ? `${summary.nano.leaked} of ${summary.planted} planted details still visible. ${formatMs(summary.nano.msPerDocument)} per document.`
                  : running && usedNano
                    ? 'Shown when every document has been read.'
                    : 'Gemini Nano did not run.'
              }
              tone="text-device-700"
            />
            <Stat
              label="Sent to the cloud"
              value="0"
              detail="Detection runs on this device. The test never makes a cloud call; the privacy ledger shows every on-device call it made."
              tone="text-cloud-700"
            />
          </dl>

          <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Leak test results per document</caption>
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Document</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Leaked: regex only</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Leaked: regex + Nano</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Time with Nano</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const stillLeaked = (row.nano ?? row.regex).score.leaked
                  return (
                    <tr key={row.id} className="align-top">
                      <th scope="row" className="px-4 py-3 font-normal">
                        <span className="font-medium text-stone-900">{row.title}</span>
                        {stillLeaked.length > 0 && (
                          <span className="mt-1 block text-xs leading-relaxed text-rose-700">
                            Still visible{row.nano ? ' with Nano' : ''}:{' '}
                            {stillLeaked.map((detail) => `${detail.planted.value} (${TYPE_LABELS[detail.planted.type]})`).join('; ')}
                          </span>
                        )}
                        {row.nano && row.nano.failures > 0 && (
                          <span className="mt-1 block text-xs text-amber-700">
                            Gemini Nano failed on this document, so it was checked with patterns only.
                          </span>
                        )}
                      </th>
                      <td className="px-4 py-3 text-right"><LeakCell result={row.regex} /></td>
                      <td className="px-4 py-3 text-right"><LeakCell result={row.nano} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">{row.nano ? formatMs(row.nano.ms) : 'n/a'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {finished && (
            <section aria-labelledby="markdown-title" className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="markdown-title" className="font-serif text-xl text-device-900">Results as Markdown</h2>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
                >
                  <Icon name={copied ? 'check' : 'file'} /> {copied ? 'Copied' : 'Copy table'}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-white p-4 font-mono text-[11.5px] leading-relaxed text-stone-800">
                {toMarkdown(rows)}
              </pre>
            </section>
          )}
        </>
      )}

      <section aria-labelledby="corpus-title" className="mt-10">
        <h2 id="corpus-title" className="font-serif text-xl text-device-900">The test documents</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
          Every person, organisation, address and number below is invented. Open a document to see its text and the
          details planted in it.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {EVAL_CORPUS.map((document) => (
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
      </section>

      <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-muted">
        How to read this: the test measures detection, the first line of defence. In the app you also review the
        redacted text before sending. The leak guard cannot catch what was never detected, which is why this number
        matters. Ten documents is a small sample; treat the result as an indication, not a guarantee.
      </p>
    </div>
  )
}
