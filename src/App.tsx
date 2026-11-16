import { useEffect, useState } from 'react'
import { useDeviceModel } from './ai/useDeviceModel'
import { Header } from './components/Header'
import { useHashRoute } from './components/useHashRoute'
import { useOnline } from './components/useOnline'
import { EvalPage } from './features/eval/EvalPage'
import { AnswerTools } from './features/explain/AnswerTools'
import { FollowUpBox } from './features/followup/FollowUpBox'
import { IngestPanel } from './features/ingest/IngestPanel'
import { RoutingCheck } from './features/routing/RoutingCheck'
import { useSession } from './features/session/useSession'
import { Workspace } from './features/workspace/Workspace'
import { LedgerDrawer } from './ledger/LedgerDrawer'

function Reading({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-32 text-center" role="status" aria-live="polite">
      <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-device-100 border-t-device-600" aria-hidden="true" />
      <h1 className="mt-5 font-serif text-2xl text-device-900">{label}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">This happens on your device. Nothing is being uploaded.</p>
      <button type="button" onClick={onCancel} className="mt-6 text-sm font-medium text-stone-600 underline-offset-2 hover:underline">
        Cancel
      </button>
    </div>
  )
}

export default function App() {
  const device = useDeviceModel()
  const online = useOnline()
  const route = useHashRoute()
  const session = useSession()
  const [ledgerOpen, setLedgerOpen] = useState(false)

  // Deep link: #/sample/lab-report opens a sample document directly.
  const { loadSample } = session
  useEffect(() => {
    const match = route.match(/^\/sample\/([\w-]+)$/)
    if (!match) return
    loadSample(match[1])
    window.history.replaceState(null, '', '#/')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [route, loadSample])

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <Header device={device} online={online} route={route} onOpenLedger={() => setLedgerOpen(true)} />
      <main id="main" className="flex-1">
        {route === '/routing' ? (
          <RoutingCheck device={device} />
        ) : route === '/eval' ? (
          <EvalPage device={device} />
        ) : session.stage === 'empty' ? (
          <IngestPanel session={session} device={device} />
        ) : session.stage === 'reading' ? (
          <Reading label={session.readingLabel} onCancel={session.reset} />
        ) : (
          <Workspace
            session={session}
            device={device}
            online={online}
            tools={<AnswerTools session={session} />}
            followUp={<FollowUpBox session={session} online={online} />}
          />
        )}
      </main>
      <LedgerDrawer open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </div>
  )
}
