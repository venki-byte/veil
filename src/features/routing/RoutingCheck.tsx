import { useState } from 'react'
import {
  cloudModelInfo,
  describeError,
  InferenceMode,
  LeakBlockedError,
  runLeakGuardDemo,
  runRouteCheck,
  type AiResult,
  type DeviceState,
  type Mode,
} from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { ModeChip, RoutingTable } from '../../components/RoutingTable'
import { SourceBadge } from '../../components/SourceBadge'
import { useOnline } from '../../components/useOnline'
import { firebaseConfigured, getAppCheckMode } from '../../firebase'
import { DiagnosticReport } from './DiagnosticReport'

const MODES: Array<{ mode: Mode; expect: string }> = [
  { mode: InferenceMode.ONLY_ON_DEVICE, expect: 'Always ON_DEVICE. Fails if Gemini Nano is not ready.' },
  { mode: InferenceMode.PREFER_ON_DEVICE, expect: 'ON_DEVICE when Gemini Nano is ready, otherwise IN_CLOUD.' },
  { mode: InferenceMode.PREFER_IN_CLOUD, expect: 'IN_CLOUD when online, otherwise ON_DEVICE.' },
  { mode: InferenceMode.ONLY_IN_CLOUD, expect: 'Always IN_CLOUD. Fails when offline.' },
]

type CheckState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: AiResult<string> }
  | { status: 'failed'; message: string }

type GuardState = { status: 'idle' | 'running' } | { status: 'blocked'; message: string } | { status: 'failed'; message: string }

function Fact({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium ${good ? 'text-stone-900' : 'text-amber-700'}`}>{value}</dd>
    </div>
  )
}

/**
 * Diagnostics: runs one harmless call in each of the four inference modes and
 * shows where each one actually ran, plus a live leak guard demonstration.
 */
export function RoutingCheck({ device }: { device: DeviceState }) {
  const online = useOnline()
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const [guard, setGuard] = useState<GuardState>({ status: 'idle' })

  const runOne = async (mode: Mode) => {
    setChecks((current) => ({ ...current, [mode]: { status: 'running' } }))
    try {
      const result = await runRouteCheck(mode)
      setChecks((current) => ({ ...current, [mode]: { status: 'done', result } }))
    } catch (error) {
      setChecks((current) => ({ ...current, [mode]: { status: 'failed', message: describeError(error) } }))
    }
  }

  const runAll = async () => {
    for (const { mode } of MODES) await runOne(mode)
  }

  const runGuard = async () => {
    setGuard({ status: 'running' })
    try {
      await runLeakGuardDemo()
    } catch (error) {
      if (error instanceof LeakBlockedError) setGuard({ status: 'blocked', message: error.message })
      else setGuard({ status: 'failed', message: describeError(error) })
    }
  }

  const anyRunning = Object.values(checks).some((check) => check.status === 'running')
  const appCheck = firebaseConfigured ? getAppCheckMode() : 'missing'

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <a href="#/" className="inline-flex items-center gap-1.5 text-sm font-medium text-device-700 hover:underline">
        <Icon name="arrowLeft" /> Back to Veil
      </a>
      <h1 className="mt-4 font-serif text-3xl text-device-900">Routing check</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-muted">
        Veil uses all four Firebase AI Logic inference modes, each for a stated reason. This page runs one
        harmless fixed prompt through each mode and shows where it actually ran, as reported by the SDK.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Fact label="Firebase" value={firebaseConfigured ? 'Configured' : 'Not configured'} good={firebaseConfigured} />
        <Fact
          label="App Check"
          value={appCheck === 'debug' ? 'Debug provider' : appCheck === 'recaptcha' ? 'reCAPTCHA' : 'Not active yet'}
          good={appCheck !== 'missing'}
        />
        <Fact label="Gemini Nano" value={device.status} good={device.status === 'ready'} />
        <Fact label="Network" value={online ? 'Online' : 'Offline'} good={online} />
      </dl>
      <p className="mt-2 text-xs text-muted">
        Cloud model: <span className="font-mono">{cloudModelInfo().model}</span> (falls back to{' '}
        <span className="font-mono">{cloudModelInfo().fallback}</span>; setting from {cloudModelInfo().source}). On-device
        detection: {cloudModelInfo().detectionPasses === 2 ? 'two passes' : 'one pass'}.
        {appCheck === 'debug' && ' The App Check debug token is printed in the browser console when the page loads.'}
      </p>

      <DiagnosticReport device={device} />

      <div className="mt-8 flex items-center justify-between gap-4">
        <h2 className="font-serif text-xl text-device-900">One call per mode</h2>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={anyRunning || !firebaseConfigured}
          className="inline-flex items-center gap-2 rounded-lg bg-device-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-device-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="route" /> Run all four
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-2.5">
        {MODES.map(({ mode, expect }) => {
          const check = checks[mode] ?? { status: 'idle' }
          return (
            <li key={mode} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <ModeChip mode={mode} />
                  <p className="mt-1.5 text-sm text-muted">Expected: {expect}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void runOne(mode)}
                  disabled={check.status === 'running' || !firebaseConfigured}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {check.status === 'running' ? 'Running' : 'Run'}
                </button>
              </div>
              <div aria-live="polite">
                {check.status === 'done' && (
                  <p className="fade-in mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
                    <SourceBadge source={check.result.source} durationMs={check.result.durationMs} />
                    <span className="text-stone-700">“{check.result.value.trim().slice(0, 160)}”</span>
                  </p>
                )}
                {check.status === 'failed' && (
                  <p className="fade-in mt-3 flex items-start gap-2 border-t border-line pt-3 text-sm text-amber-800">
                    <Icon name="alert" className="mt-0.5 shrink-0" /> {check.message}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <h2 className="mt-10 font-serif text-xl text-device-900">Leak guard demonstration</h2>
      <div className="mt-3 rounded-xl border border-line bg-white p-4">
        <p className="text-sm leading-relaxed text-muted">
          This tries to send a cloud request that still contains an invented phone number registered as hidden,
          written with different spacing. The leak guard is plain code that checks every outgoing request against
          every hidden value. It should refuse, and the attempt should appear in the privacy ledger as blocked.
        </p>
        <button
          type="button"
          onClick={() => void runGuard()}
          disabled={guard.status === 'running'}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          <Icon name="block" /> Try to leak a planted value
        </button>
        <div aria-live="polite">
          {guard.status === 'blocked' && (
            <p className="fade-in mt-3 flex items-start gap-2 text-sm font-medium text-device-700">
              <Icon name="shieldCheck" className="mt-0.5 shrink-0" /> {guard.message} Nothing was sent.
            </p>
          )}
          {guard.status === 'failed' && (
            <p className="fade-in mt-3 flex items-start gap-2 text-sm text-rose-700">
              <Icon name="alert" className="mt-0.5 shrink-0" /> {guard.message}
            </p>
          )}
        </div>
      </div>

      <h2 className="mt-10 font-serif text-xl text-device-900">Routing table</h2>
      <div className="mt-3">
        <RoutingTable />
      </div>
    </div>
  )
}
