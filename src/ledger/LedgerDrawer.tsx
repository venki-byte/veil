import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import { formatDuration } from '../components/format'
import { SourceBadge } from '../components/SourceBadge'
import { clearLedger, summariseLedger, useLedger, type LedgerEntry } from './store'

function StatusMark({ entry }: { entry: LedgerEntry }) {
  if (entry.status === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-rose-700 ring-1 ring-inset ring-rose-200">
        <Icon name="block" size={12} /> BLOCKED
      </span>
    )
  }
  if (entry.status === 'error' && !entry.source) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
        <Icon name="alert" size={12} /> FAILED
      </span>
    )
  }
  return entry.source ? <SourceBadge source={entry.source} durationMs={entry.durationMs} /> : null
}

function EntryCard({ entry }: { entry: LedgerEntry }) {
  const time = new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <li className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{entry.task}</span>
        <StatusMark entry={entry} />
      </div>
      <p className="mt-1 text-xs text-muted">
        <span className="font-mono">{entry.mode.toUpperCase()}</span> · {time}
        {entry.status === 'error' && entry.source && ` · failed after ${formatDuration(entry.durationMs)}`}
      </p>

      {entry.note && <p className="mt-2 text-xs leading-relaxed text-stone-700">{entry.note}</p>}
      {entry.error && <p className="mt-2 text-xs leading-relaxed text-rose-700">{entry.error}</p>}

      {entry.outbound !== null ? (
        <details className="mt-2 rounded-md bg-cloud-50 text-xs">
          <summary className="cursor-pointer select-none px-2.5 py-1.5 font-medium text-cloud-700">
            Sent to the cloud: {entry.outbound.length.toLocaleString()} characters. Show exact text
          </summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-cloud-100 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-stone-800">
            {entry.outbound}
          </pre>
        </details>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 rounded-md bg-device-50 px-2.5 py-1.5 text-xs font-medium text-device-700">
          <Icon name="lock" size={12} />
          Nothing left this device
          {entry.status === 'ok' &&
            ` (${entry.hadImage ? 'photo and ' : ''}${entry.inputChars.toLocaleString()} characters read locally)`}
        </p>
      )}
    </li>
  )
}

interface LedgerDrawerProps {
  open: boolean
  onClose: () => void
}

/** Slide-over panel listing every model call made in this session. */
export function LedgerDrawer({ open, onClose }: LedgerDrawerProps) {
  const entries = useLedger()
  const closeRef = useRef<HTMLButtonElement>(null)
  const totals = summariseLedger(entries)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-stone-900/30" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-title"
        className="slide-in absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-paper shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line bg-white px-5 py-4">
          <div>
            <h2 id="ledger-title" className="font-serif text-xl text-device-900">
              Privacy ledger
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Every model call in this session, where it ran, and exactly what was sent. Kept in memory only.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close privacy ledger"
            className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <dl className="grid grid-cols-4 gap-px border-b border-line bg-line text-center">
          {[
            ['On device', totals.onDevice, 'text-device-700'],
            ['In cloud', totals.inCloud, 'text-cloud-700'],
            ['Blocked', totals.blocked, 'text-rose-700'],
            ['Chars sent', totals.charsSent.toLocaleString(), 'text-stone-800'],
          ].map(([label, value, tone]) => (
            <div key={label} className="bg-white px-2 py-2.5">
              <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
              <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
            </div>
          ))}
        </dl>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {entries.length === 0 ? (
            <div className="mt-10 text-center text-sm text-muted">
              <Icon name="list" size={28} className="mx-auto mb-3 text-stone-400" />
              <p className="font-medium text-stone-700">No model calls yet</p>
              <p className="mt-1">Open a document and each step will be listed here as it runs.</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {[...entries].reverse().map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
        </div>

        {entries.length > 0 && (
          <footer className="border-t border-line bg-white px-5 py-3">
            <button
              type="button"
              onClick={clearLedger}
              className="text-xs font-medium text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline"
            >
              Clear ledger
            </button>
          </footer>
        )}
      </aside>
    </div>
  )
}
