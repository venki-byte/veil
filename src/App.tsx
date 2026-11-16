import { useState } from 'react'
import { useDeviceModel } from './ai/useDeviceModel'
import { PrivateModeCard } from './components/DeviceStatus'
import { Header } from './components/Header'
import { RoutingTable } from './components/RoutingTable'
import { SetupNotice } from './components/SetupNotice'
import { useHashRoute } from './components/useHashRoute'
import { useOnline } from './components/useOnline'
import { RoutingCheck } from './features/routing/RoutingCheck'
import { firebaseConfigured } from './firebase'
import { LedgerDrawer } from './ledger/LedgerDrawer'

export default function App() {
  const device = useDeviceModel()
  const online = useOnline()
  const route = useHashRoute()
  const [ledgerOpen, setLedgerOpen] = useState(false)

  return (
    <div className="flex min-h-full flex-col">
      <Header device={device} online={online} route={route} onOpenLedger={() => setLedgerOpen(true)} />
      <main className="flex-1">
        {route === '/routing' ? (
          <RoutingCheck device={device} />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-10 sm:px-6">
            <h1 className="font-serif text-4xl text-device-900">Veil</h1>
            <p className="text-lg text-muted">
              Explains sensitive paperwork without the personal details ever leaving your device.
            </p>
            {!firebaseConfigured && <SetupNotice />}
            <PrivateModeCard device={device} />
            <RoutingTable />
          </div>
        )}
      </main>
      <LedgerDrawer open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </div>
  )
}
