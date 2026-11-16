import { setUpDeviceModel, type DeviceState } from '../ai/hybrid'
import { firebaseConfigured } from '../firebase'
import { Icon } from './Icon'

const PILL: Record<DeviceState['status'], { text: string; dot: string; className: string }> = {
  checking: { text: 'Checking on-device AI', dot: 'bg-stone-400', className: 'text-stone-600 ring-stone-200' },
  ready: { text: 'Gemini Nano ready', dot: 'bg-device-600', className: 'text-device-700 ring-device-200' },
  downloadable: { text: 'Private mode not set up', dot: 'bg-amber-500', className: 'text-amber-800 ring-amber-200' },
  downloading: { text: 'Downloading Gemini Nano', dot: 'bg-amber-500 animate-pulse', className: 'text-amber-800 ring-amber-200' },
  unavailable: { text: 'Gemini Nano unavailable', dot: 'bg-rose-500', className: 'text-rose-700 ring-rose-200' },
}

/** Compact status pill for the header. */
export function DeviceStatusPill({ device }: { device: DeviceState }) {
  const pill = PILL[device.status]
  const percent = device.progress !== null ? ` ${Math.round(device.progress * 100)}%` : ''
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${pill.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} aria-hidden="true" />
      {pill.text}
      {device.status === 'downloading' && percent}
    </span>
  )
}

/**
 * Explains the on-device model state and offers the one action that fits it.
 * Rendered wherever the user needs to act: nothing is shown once Nano is ready.
 */
export function PrivateModeCard({ device }: { device: DeviceState }) {
  if (device.status === 'ready' || device.status === 'checking') return null

  if (device.status === 'unavailable') {
    return (
      <section
        aria-label="Reduced protection"
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <Icon name="alert" /> Reduced protection in this browser
        </h3>
        <p className="mt-1.5 leading-relaxed">
          Gemini Nano is not available here, so Veil can only find personal details that have a fixed shape
          (emails, phone numbers, IDs, account numbers) or follow a label such as “Name:”. Names and addresses
          inside sentences will be missed unless you hide them yourself in the review step. Photos are
          switched off. Nothing is ever sent without your review.
        </p>
        <p className="mt-1.5 text-amber-800">
          For full protection use Chrome 139 or later on a desktop, with{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-[12px]">
            chrome://flags/#prompt-api-for-gemini-nano-multimodal-input
          </code>{' '}
          enabled.
        </p>
      </section>
    )
  }

  const downloading = device.status === 'downloading'
  const percent = Math.round((device.progress ?? 0) * 100)

  return (
    <section aria-label="Set up private mode" className="rounded-xl border border-device-200 bg-device-50 p-4 text-sm">
      <h3 className="flex items-center gap-2 font-semibold text-device-900">
        <Icon name="shield" /> Set up private mode
      </h3>
      <p className="mt-1.5 leading-relaxed text-device-900/80">
        Veil uses Gemini Nano, a model that runs inside Chrome, to read your document and find personal details
        without sending anything anywhere. It needs a one-time download, which can take several minutes.
      </p>

      {downloading ? (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label="Gemini Nano download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 overflow-hidden rounded-full bg-device-100"
          >
            <div className="h-full rounded-full bg-device-600 transition-[width] duration-300" style={{ width: `${Math.max(percent, 3)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-device-700">
            {percent < 100 ? `Downloading: ${percent}%` : 'Finishing setup'} · You can keep this tab open and wait.
          </p>
        </div>
      ) : (
        <button
          type="button"
          disabled={!firebaseConfigured}
          onClick={() => void setUpDeviceModel()}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-device-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-device-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="download" /> Set up private mode
        </button>
      )}

      {device.error && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          Setup did not finish: {device.error}
        </p>
      )}
    </section>
  )
}
