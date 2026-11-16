import type { DeviceState } from '../ai/hybrid'
import { useLedger } from '../ledger/store'
import { DeviceStatusPill } from './DeviceStatus'
import { Icon } from './Icon'

interface HeaderProps {
  device: DeviceState
  online: boolean
  route: string
  onOpenLedger: () => void
}

export function Header({ device, online, route, onOpenLedger }: HeaderProps) {
  const entries = useLedger()
  const blocked = entries.filter((entry) => entry.status === 'blocked').length

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
        <a href="#/" className="flex items-center gap-2.5 rounded-md" aria-label="Veil home">
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
          <span className="font-serif text-xl leading-none text-device-900">Veil</span>
          <span className="hidden text-xs text-muted md:inline">Private document explainer</span>
        </a>

        <nav className="flex items-center gap-2" aria-label="Status and tools">
          {!online && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 rounded-full bg-stone-800 px-2.5 py-1 text-xs font-medium text-white"
            >
              <Icon name="offline" size={13} /> Offline
            </span>
          )}
          <span className="hidden sm:inline-flex">
            <DeviceStatusPill device={device} />
          </span>
          <a
            href={route === '/routing' ? '#/' : '#/routing'}
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-200/60 sm:inline-flex"
          >
            <Icon name="route" /> {route === '/routing' ? 'Back to app' : 'Routing'}
          </a>
          <button
            type="button"
            onClick={onOpenLedger}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50"
          >
            <Icon name="list" />
            <span>
              Privacy ledger
            </span>
            <span
              className={`rounded-full px-1.5 text-xs tabular-nums ${blocked ? 'bg-rose-100 text-rose-700' : 'bg-stone-100 text-stone-700'}`}
              aria-label={`${entries.length} calls recorded`}
            >
              {entries.length}
            </span>
          </button>
        </nav>
      </div>
    </header>
  )
}
