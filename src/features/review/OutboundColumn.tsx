import { useMemo, useState } from 'react'
import { ROUTES, type DeviceState } from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { ModeChip } from '../../components/RoutingTable'
import { firebaseConfigured } from '../../firebase'
import type { Entry } from '../../privacy/registry'
import { REDACT_TYPES, TYPE_LABELS, type SensitiveType } from '../../privacy/types'
import type { Session } from '../session/useSession'

const SOURCE_LABEL: Record<Entry['source'], string> = {
  regex: 'Pattern',
  nano: 'Gemini Nano',
  manual: 'You',
}

function Placeholder({ entry }: { entry: Entry }) {
  return (
    <span
      title={`${TYPE_LABELS[entry.type]}: the real value stays on this device`}
      className="rounded bg-cloud-100 px-1 py-px font-mono text-[0.92em] font-medium text-cloud-700 ring-1 ring-inset ring-cloud-200"
    >
      {entry.placeholder}
    </span>
  )
}

function EntryRow({ entry, onToggle }: { entry: Entry; onToggle: (enabled: boolean) => void }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="w-32 shrink-0 truncate font-mono text-[11px] text-cloud-700">
        {entry.enabled ? entry.placeholder : TYPE_LABELS[entry.type]}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-stone-800" title={entry.value}>
        {entry.value}
      </span>
      <span className="hidden shrink-0 text-[11px] text-muted sm:inline">{SOURCE_LABEL[entry.source]}</span>
      <button
        type="button"
        role="switch"
        aria-checked={entry.enabled}
        aria-label={`Hide ${entry.value}`}
        onClick={() => onToggle(!entry.enabled)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${entry.enabled ? 'bg-device-600' : 'bg-stone-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${entry.enabled ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </li>
  )
}

interface OutboundColumnProps {
  session: Session
  device: DeviceState
  online: boolean
}

/**
 * Column 2: exactly what will leave this device. The user can show or hide
 * any detail, add their own, and must confirm before anything is sent.
 */
export function OutboundColumn({ session, device, online }: OutboundColumnProps) {
  const { doc, registry, version, detection, liveLeaks } = session
  const [manualValue, setManualValue] = useState('')
  const [manualType, setManualType] = useState<SensitiveType>('PERSON')
  const [manualError, setManualError] = useState(false)
  const [reviewed, setReviewed] = useState(false)

  const segments = useMemo(
    () => (doc ? registry.segments(doc.text) : []),
    // `version` changes whenever the registry is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, registry, version],
  )
  const entries = useMemo(
    () => registry.list(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, version],
  )

  if (!doc) return null

  const hidden = entries.filter((entry) => entry.enabled)
  const visible = entries.filter((entry) => !entry.enabled)
  const detecting = detection?.running ?? false
  const reduced = !detecting && detection !== null && (!detection.nanoUsed || detection.nanoFailures > 0)
  const explaining = session.busy.includes('explain')
  const quickReading = session.busy.includes('quick')
  const strictRunning = session.busy.includes('strict')
  const deviceReady = device.status === 'ready'
  const guardPassed = liveLeaks.length === 0
  // One explanation at a time: the standard and strict runs do not overlap.
  const canSend =
    !detecting && guardPassed && firebaseConfigured && (!reduced || reviewed) && !explaining && !strictRunning

  const addManual = () => {
    const ok = session.addManual(manualValue, manualType)
    setManualError(!ok)
    if (ok) setManualValue('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {session.strictTrail && (
          <p role="status" className="flex items-start gap-2 border-b border-device-200 bg-device-50 px-4 py-3 text-xs leading-relaxed text-device-900">
            <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">Strict mode was used, so the text below was not sent.</span> The cloud
              received only the kind of document and {session.strictTrail.facts.length} short answers. They are listed
              with the explanation.
            </span>
          </p>
        )}
        {reduced && (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
            <p className="flex items-center gap-1.5 font-semibold">
              <Icon name="alert" size={14} /> Reduced protection
            </p>
            <p className="mt-1">
              {detection?.nanoFailures && detection.nanoUsed
                ? `${detection.nanoFailures} of Gemini Nano's checks on this document failed, so parts of it were checked by patterns and the other pass only.`
                : 'Gemini Nano did not check this document, so only details with a fixed shape or a clear label were found.'}{' '}
              Names and addresses inside sentences may still be visible below. Read the text and hide anything
              personal before you continue.
            </p>
          </div>
        )}

        <div className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12.5px] leading-relaxed text-stone-800">
          {segments.map((segment, index) =>
            segment.entry ? <Placeholder key={index} entry={segment.entry} /> : <span key={index}>{segment.text}</span>,
          )}
        </div>

        <section aria-labelledby="details-title" className="border-t border-line px-4 py-4">
          <h3 id="details-title" className="flex items-center justify-between text-sm font-semibold">
            Hidden details
            <span className="rounded-full bg-device-50 px-2 py-0.5 text-xs font-medium tabular-nums text-device-700">
              {hidden.length}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            This list stays on your device. Switch a detail off to leave it visible to the cloud.
          </p>

          {hidden.length > 0 ? (
            <ul className="mt-2 divide-y divide-line">
              {hidden.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onToggle={(enabled) => session.setEntryEnabled(entry.id, enabled)} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2.5 text-xs text-muted">
              {detecting ? 'Looking for personal details.' : 'No personal details were found. Check the text above and hide anything personal yourself.'}
            </p>
          )}

          {visible.length > 0 && (
            <>
              <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                Left visible ({visible.length})
              </h4>
              <p className="mt-0.5 text-xs text-muted">
                Dates other than birth dates stay visible so deadlines can be explained. Switch any of them on to hide it.
              </p>
              <ul className="mt-1 divide-y divide-line">
                {visible.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} onToggle={(enabled) => session.setEntryEnabled(entry.id, enabled)} />
                ))}
              </ul>
            </>
          )}

          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              addManual()
            }}
          >
            <label className="min-w-40 flex-1 text-xs font-medium text-stone-700">
              Hide another word or phrase
              <input
                value={manualValue}
                onChange={(event) => {
                  setManualValue(event.target.value)
                  setManualError(false)
                }}
                placeholder="Type it exactly as written"
                aria-invalid={manualError}
                className="mt-1 w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] font-normal placeholder:text-stone-400 focus:border-device-600 focus:outline-none focus:ring-1 focus:ring-device-600"
              />
            </label>
            <select
              aria-label="Type of detail"
              value={manualType}
              onChange={(event) => setManualType(event.target.value as SensitiveType)}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-[13px]"
            >
              {REDACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={manualValue.trim().length < 2}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] font-medium hover:bg-stone-50 disabled:opacity-40"
            >
              <Icon name="plus" size={14} /> Hide
            </button>
            {manualError && (
              <p role="alert" className="w-full text-xs text-rose-700">
                That is too short or too vague to hide safely. Use at least two characters.
              </p>
            )}
          </form>
        </section>
      </div>

      <div className="border-t border-line bg-white px-4 py-3">
        <p
          role="status"
          className={`flex items-center gap-1.5 text-xs font-medium ${guardPassed ? 'text-device-700' : 'text-rose-700'}`}
        >
          <Icon name={guardPassed ? 'shieldCheck' : 'block'} size={14} />
          {detecting
            ? `Gemini Nano is reading on this device: part ${Math.min(detection!.done + 1, Math.max(detection!.total, 1))} of ${Math.max(detection!.total, 1)}`
            : guardPassed
              ? `Leak guard passed: none of the ${hidden.length} hidden values appear in this text.`
              : `Leak guard: ${liveLeaks.map((leak) => leak.placeholder).join(', ')} still present. Sending is blocked.`}
        </p>

        {session.leaks && (
          <p role="alert" className="mt-2 rounded-md bg-rose-50 px-2.5 py-2 text-xs leading-relaxed text-rose-800">
            The leak guard stopped the request before it was sent. Still present:{' '}
            {[...new Set(session.leaks.map((leak) => leak.placeholder))].join(', ')}. Hide the remaining text and try again.
          </p>
        )}
        {session.error && !session.leaks && (
          <p role="alert" className="mt-2 rounded-md bg-rose-50 px-2.5 py-2 text-xs leading-relaxed text-rose-800">
            {session.error}
          </p>
        )}

        {reduced && (
          <label className="mt-2.5 flex items-start gap-2 text-xs text-stone-800">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-device-700"
            />
            I have read the text above and hidden everything personal.
          </label>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {online ? (
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void session.explain()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-cloud-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cloud-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="send" />
              {explaining ? 'Sending redacted text' : session.explanation ? 'Explain again' : 'Send redacted text for explanation'}
            </button>
          ) : (
            <p className="flex flex-1 items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-2.5 text-xs text-stone-700">
              <Icon name="offline" size={14} /> You are offline. The full explanation will be offered when you reconnect.
            </p>
          )}
          {deviceReady && (
            <button
              type="button"
              disabled={!canSend || quickReading}
              onClick={() => void session.runQuickRead()}
              title={ROUTES.quickRead.why}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                online
                  ? 'border border-device-200 bg-device-50 text-device-700 hover:bg-device-100'
                  : 'flex-1 bg-device-700 text-white shadow-sm hover:bg-device-900'
              }`}
            >
              <Icon name="chip" /> {quickReading ? 'Reading' : 'Quick read on this device'}
            </button>
          )}
          {deviceReady && online && (
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void session.runStrictMode()}
              title="The cloud never receives this text. It sees only the kind of document and short answers written by Gemini Nano on this device."
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="lock" /> {strictRunning ? 'Strict mode running' : 'Strict mode'}
            </button>
          )}
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          {online ? (
            <>
              <ModeChip mode={ROUTES.explain.mode} /> {session.redacted.length.toLocaleString()} characters of redacted
              text plus fixed instructions. The exact request is in the privacy ledger.
              {deviceReady && ' Strict mode sends none of this text: only the kind of document and short answers.'}
            </>
          ) : deviceReady ? (
            <>
              <ModeChip mode={ROUTES.quickRead.mode} /> A lighter answer from Gemini Nano. Nothing is sent.
            </>
          ) : (
            'Gemini Nano is not available, so nothing can run until you are back online.'
          )}
        </p>
        {!firebaseConfigured && (
          <p className="mt-1.5 text-[11px] text-rose-700">Add your Firebase config to .env to enable model calls.</p>
        )}
      </div>
    </div>
  )
}
