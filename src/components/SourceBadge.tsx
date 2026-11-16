import { formatDuration } from './format'
import { Icon } from './Icon'

/**
 * Where a step ran. Shown on every result so the user can always see
 * whether something stayed on the device or went to the cloud.
 */
export type BadgeSource = 'on_device' | 'in_cloud' | 'local_code'

const STYLES: Record<BadgeSource, { label: string; title: string; className: string; icon: 'chip' | 'cloud' | 'code' }> = {
  on_device: {
    label: 'ON_DEVICE',
    title: 'Ran on this device with Gemini Nano. Nothing was sent anywhere.',
    className: 'bg-device-50 text-device-700 ring-device-200',
    icon: 'chip',
  },
  in_cloud: {
    label: 'IN_CLOUD',
    title: 'Ran in the cloud on redacted text only. See the privacy ledger for exactly what was sent.',
    className: 'bg-cloud-50 text-cloud-700 ring-cloud-200',
    icon: 'cloud',
  },
  local_code: {
    label: 'LOCAL CODE',
    title: 'Plain code running in this browser tab. No AI model involved.',
    className: 'bg-stone-100 text-stone-700 ring-stone-200',
    icon: 'code',
  },
}

interface SourceBadgeProps {
  source: BadgeSource
  /** Optional duration in milliseconds, shown after the label. */
  durationMs?: number
  className?: string
}

export function SourceBadge({ source, durationMs, className = '' }: SourceBadgeProps) {
  const style = STYLES[source]
  return (
    <span
      title={style.title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide ring-1 ring-inset ${style.className} ${className}`}
    >
      <Icon name={style.icon} size={12} />
      {style.label}
      {durationMs !== undefined && <span className="font-normal opacity-70">· {formatDuration(durationMs)}</span>}
    </span>
  )
}
