import { useRef, useState } from 'react'
import {
  answerFollowUp,
  answerFollowUpOnDevice,
  answerOnDevice,
  classifyDocument,
  cloudModelInfo,
  defineTerm,
  describeError,
  detectionPasses,
  detectSensitive,
  explainDocument,
  explainFromFacts,
  getDeviceState,
  LeakBlockedError,
  planStrictQuestions,
  quickRead,
  refreshDeviceStatus,
  runLeakGuardDemo,
  runRouteCheck,
  simplify,
  translate,
  type DeviceState,
  type Mode,
} from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { useOnline } from '../../components/useOnline'
import { getConsoleEntries } from '../../diagnostics/consoleLog'
import { E2E_TOTAL, runEndToEnd } from '../../diagnostics/e2e'
import { buildReport, type CheckOutcome } from '../../diagnostics/report'
import { runDiagnostics } from '../../diagnostics/run'
import { firebaseConfigured, getAppCheckMode } from '../../firebase'
import { getLedger } from '../../ledger/store'
import { Registry } from '../../privacy/registry'
import { SAMPLES } from '../ingest/samples'

type Kind = 'quick' | 'full'
type Phase =
  | { name: 'idle' }
  | { name: 'running'; kind: Kind; done: number; total: number; title: string; step?: string }
  | { name: 'done'; copied: boolean | null }

/** The registry the quick report's explanation check uses. Both values are invented. */
function sampleRegistry(): Registry {
  const registry = new Registry()
  registry.add('Asha Verma', 'PERSON', 'manual')
  registry.add('98765 43210', 'CONTACT', 'manual')
  return registry
}

const NOT_CONFIGURED: CheckOutcome[] = [
  {
    title: 'Firebase configuration',
    expected: 'values present in .env',
    status: 'fail',
    detail: 'Firebase is not configured, so no model call can run. Check that .env exists and restart the dev server.',
  },
]

/**
 * Two buttons that run checks, build a plain-text report, and copy it to the
 * clipboard so it can be pasted into a chat. The report never contains
 * document text, API keys or tokens.
 */
export function DiagnosticReport({ device }: { device: DeviceState }) {
  const online = useOnline()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [report, setReport] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)

  const run = async (kind: Kind) => {
    setReport('')
    // Time the tab spends hidden: Chrome slows Gemini Nano in a background tab.
    let hiddenMs = 0
    let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenSince = Date.now()
      else if (hiddenSince !== null) {
        hiddenMs += Date.now() - hiddenSince
        hiddenSince = null
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    setPhase({ name: 'running', kind, done: 0, total: kind === 'quick' ? 7 : E2E_TOTAL, title: 'Starting' })
    // Use a fresh look at the model: the page may have been open for a while.
    const current = firebaseConfigured ? await refreshDeviceStatus() : getDeviceState()
    const onProgress = (done: number, total: number, title: string) => setPhase({ name: 'running', kind, done, total, title })

    let outcomes: CheckOutcome[] = NOT_CONFIGURED
    let appendix = ''

    if (firebaseConfigured && kind === 'quick') {
      outcomes = await runDiagnostics({
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
        onProgress,
      })
    } else if (firebaseConfigured) {
      const lab = SAMPLES.find((sample) => sample.id === 'lab-report')!
      // Stream three of the calls exactly as the app does, and count the pieces.
      const pieces = { followUp: 0, simplify: 0, quickRead: 0 }
      const count = (task: keyof typeof pieces) => () => {
        pieces[task] += 1
      }
      const result = await runEndToEnd({
        sampleText: lab.text,
        mustBeHidden: ['Meenakshi', 'Raghavan', 'Deshpande', 'Subramaniam', 'Lake View Road'],
        followUpExpect: '10.8',
        followUpQuestion: 'What is the haemoglobin result for Meenakshi Raghavan?',
        term: 'HbA1c',

        detectPasses: detectionPasses(),
        explain: (redacted, registry) => explainDocument(redacted, registry),
        followUp: (redacted, question, registry) => answerFollowUp(redacted, [], question, registry, count('followUp')),
        simplify: (text, registry) => simplify(text, registry, count('simplify')),
        define: defineTerm,
        translate: (text, registry) => translate(text, 'hi', registry),
        quickRead: (redacted, registry) => quickRead(redacted, registry, count('quickRead')),
        streamedPieces: (task) => pieces[task],

        classify: async (excerpt) => (await classifyDocument(excerpt)).value,
        plan: async (type, registry) => (await planStrictQuestions(type, registry)).value,
        answerOnDevice,
        combine: async (type, facts, registry) => (await explainFromFacts(type, facts, registry)).value,
        followUpOnDevice: (redacted, question) => answerFollowUpOnDevice(redacted, [], question),

        ledgerMark: () => getLedger().length,
        outboundSince: (mark) => getLedger().slice(mark).flatMap((entry) => (entry.outbound === null ? [] : [entry.outbound])),

        describeError,
        onProgress,
        onStep: (step) => setPhase((now) => (now.name === 'running' ? { ...now, step } : now)),
      })
      outcomes = result.outcomes
      appendix = result.appendix
    }

    document.removeEventListener('visibilitychange', onVisibility)
    if (hiddenSince !== null) hiddenMs += Date.now() - hiddenSince

    const text = buildReport({
      hiddenSeconds: hiddenMs / 1000,
      generatedAt: new Date(),
      page: window.location.href,
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      firebaseConfigured,
      appCheck: firebaseConfigured ? getAppCheckMode() : 'missing',
      debugTokenInEnv: import.meta.env.DEV && Boolean(import.meta.env.VITE_APPCHECK_DEBUG_TOKEN),
      device: { status: current.status, image: current.image, error: current.error },
      cloudModel: (() => {
        const info = cloudModelInfo()
        return `${info.model} (fallback ${info.fallback}; setting from ${info.source}); on-device detection passes: ${info.detectionPasses}`
      })(),
      checks: outcomes,
      ledger: getLedger(),
      consoleEntries: getConsoleEntries(),
      appendix,
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
  const button =
    'inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <section aria-labelledby="report-title" className="mt-8 rounded-xl border border-device-200 bg-device-50/60 p-4">
      <h2 id="report-title" className="font-serif text-xl text-device-900">
        Diagnostic report
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Runs checks, then copies one plain-text report you can paste into a chat. It contains results and errors only: no
        document text, no keys, no tokens.
        {device.status !== 'ready' && ' Gemini Nano is not ready, so the on-device checks will be reported as not passing.'}
        {!online && ' You are offline, so the cloud checks will be reported as not passing.'}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run('quick')}
          disabled={running}
          className={`${button} border border-device-200 bg-white text-device-700 hover:bg-device-50`}
        >
          <Icon name="route" /> Quick report (about 1 minute)
        </button>
        <button
          type="button"
          onClick={() => void run('full')}
          disabled={running}
          className={`${button} bg-device-700 text-white hover:bg-device-900`}
        >
          <Icon name="file" /> Full document test (3 to 6 minutes)
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        The full test runs a whole sample document through everything: detection, explanation, follow-up, simpler words,
        Hindi, quick read, strict mode, the leak test with Gemini Nano, and a privacy audit of every cloud request.
      </p>

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
            Check {Math.min(phase.done + 1, phase.total)} of {phase.total}
            {phase.step && `. Now: ${phase.step}`}
            {phase.done > 0 && `. Just finished: ${phase.title}`}. Keep this tab open and in front.
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
