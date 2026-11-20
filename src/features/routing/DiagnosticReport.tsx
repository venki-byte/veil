import { useRef, useState } from 'react'
import {
  CLOUD_MODEL,
  describeError,
  detectSensitive,
  explainDocument,
  getDeviceState,
  LeakBlockedError,
  refreshDeviceStatus,
  runLeakGuardDemo,
  runRouteCheck,
  type DeviceState,
  type Mode,
} from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { useOnline } from '../../components/useOnline'
import { getConsoleEntries } from '../../diagnostics/consoleLog'
import { buildReport } from '../../diagnostics/report'
import { runDiagnostics } from '../../diagnostics/run'
import { firebaseConfigured, getAppCheckMode } from '../../firebase'
import { getLedger } from '../../ledger/store'
import { Registry } from '../../privacy/registry'

type Phase = { name: 'idle' } | { name: 'running'; done: number; total: number; title: string } | { name: 'done'; copied: boolean | null }

/** The registry the explanation check uses. Both values are invented. */
function sampleRegistry(): Registry {
  const registry = new Registry()
  registry.add('Asha Verma', 'PERSON', 'manual')
  registry.add('98765 43210', 'CONTACT', 'manual')
  return registry
}

/**
 * One button: runs every check, builds a plain-text report, and copies it to
 * the clipboard so it can be pasted into a chat. The report never contains
 * document text, API keys or tokens.
 */
export function DiagnosticReport({ device }: { device: DeviceState }) {
  const online = useOnline()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [report, setReport] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)

  const run = async () => {
    setReport('')
    setPhase({ name: 'running', done: 0, total: 7, title: 'Starting' })
    // Use a fresh look at the model: the page may have been open for a while.
    const current = firebaseConfigured ? await refreshDeviceStatus() : getDeviceState()

    const outcomes = firebaseConfigured
      ? await runDiagnostics({
          routeCheck: async (mode) => {
            const result = await runRouteCheck(mode as Mode)
            return { source: result.source, durationMs: result.durationMs, value: result.value }
          },
          detect: detectSensitive,
          explain: (redacted) => explainDocument(redacted, sampleRegistry()),
          leakDemo: runLeakGuardDemo,
          isLeakBlocked: (error) => error instanceof LeakBlockedError,
          describeError,
          deviceReady: () => current.status === 'ready',
          online: () => navigator.onLine,
          onProgress: (done, total, title) => setPhase({ name: 'running', done, total, title }),
        })
      : [
          {
            title: 'Firebase configuration',
            expected: 'values present in .env',
            status: 'fail' as const,
            detail: 'Firebase is not configured, so no model call can run. Check that .env exists and restart the dev server.',
          },
        ]

    const text = buildReport({
      generatedAt: new Date(),
      page: window.location.href,
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      firebaseConfigured,
      appCheck: firebaseConfigured ? getAppCheckMode() : 'missing',
      debugTokenInEnv: Boolean(import.meta.env.VITE_APPCHECK_DEBUG_TOKEN),
      device: { status: current.status, image: current.image, error: current.error },
      cloudModel: CLOUD_MODEL,
      checks: outcomes,
      ledger: getLedger(),
      consoleEntries: getConsoleEntries(),
    })
    setReport(text)

    let copied: boolean | null = null
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      copied = false
    }
    setPhase({ name: 'done', copied })
  }

  const copyAgain = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setPhase({ name: 'done', copied: true })
    } catch {
      textarea.current?.select()
      setPhase({ name: 'done', copied: false })
    }
  }

  const running = phase.name === 'running'
  const percent = phase.name === 'running' ? Math.max((phase.done / phase.total) * 100, 4) : 0

  return (
    <section aria-labelledby="report-title" className="mt-8 rounded-xl border border-device-200 bg-device-50/60 p-4">
      <h2 id="report-title" className="font-serif text-xl text-device-900">
        Diagnostic report
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Runs every check below plus structured output on-device and in the cloud, then copies one plain-text report you
        can paste into a chat. It contains results and errors only: no document text, no keys, no tokens.
        {device.status !== 'ready' && ' Gemini Nano is not ready, so the on-device checks will be reported as not passing.'}
        {!online && ' You are offline, so the cloud checks will be reported as not passing.'}
      </p>

      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-device-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-device-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="file" /> {running ? 'Running checks' : report ? 'Run again and copy report' : 'Run everything and copy report'}
      </button>

      {phase.name === 'running' && (
        <div className="mt-3" role="status" aria-live="polite">
          <div
            role="progressbar"
            aria-label="Diagnostic progress"
            aria-valuemin={0}
            aria-valuemax={phase.total}
            aria-valuenow={phase.done}
            className="h-2 overflow-hidden rounded-full bg-device-100"
          >
            <div className="h-full rounded-full bg-device-600 transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Check {Math.min(phase.done + 1, phase.total)} of {phase.total}. This can take a minute or two.
          </p>
        </div>
      )}

      {phase.name === 'done' && (
        <p
          role="status"
          className={`mt-3 flex items-center gap-2 text-sm font-medium ${phase.copied ? 'text-device-700' : 'text-amber-800'}`}
        >
          <Icon name={phase.copied ? 'check' : 'alert'} />
          {phase.copied
            ? 'Report copied. Paste it into the chat now.'
            : 'Could not copy automatically. Click "Copy report" or select the text below and copy it.'}
        </p>
      )}

      {report && (
        <div className="mt-3">
          <textarea
            ref={textarea}
            readOnly
            value={report}
            aria-label="Diagnostic report text"
            rows={14}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full resize-y rounded-lg border border-line bg-white p-3 font-mono text-[11.5px] leading-relaxed text-stone-800"
          />
          <button
            type="button"
            onClick={() => void copyAgain()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            <Icon name="file" /> Copy report
          </button>
        </div>
      )}
    </section>
  )
}
