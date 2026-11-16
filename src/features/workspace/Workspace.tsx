import { useState, type ReactNode } from 'react'
import type { DeviceState } from '../../ai/hybrid'
import { Icon, type IconName } from '../../components/Icon'
import { SourceBadge, type BadgeSource } from '../../components/SourceBadge'
import { ExplanationColumn } from '../explain/ExplanationColumn'
import { OriginalColumn } from '../review/OriginalColumn'
import { OutboundColumn } from '../review/OutboundColumn'
import type { Session } from '../session/useSession'

type Tab = 'original' | 'outbound' | 'explanation'

const TABS: Array<{ id: Tab; label: string; short: string }> = [
  { id: 'original', label: 'Original', short: 'Original' },
  { id: 'outbound', label: 'What leaves this device', short: 'What leaves' },
  { id: 'explanation', label: 'Explanation', short: 'Explanation' },
]

interface ColumnProps {
  id: Tab
  active: Tab
  title: string
  subtitle: string
  icon: IconName
  tone: string
  badges: ReactNode
  children: ReactNode
}

function Column({ id, active, title, subtitle, icon, tone, badges, children }: ColumnProps) {
  return (
    <section
      id={`panel-${id}`}
      aria-labelledby={`title-${id}`}
      className={`min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-sm lg:flex ${
        active === id ? 'flex' : 'hidden'
      }`}
    >
      <header className={`border-b border-line px-4 py-3 ${tone}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`title-${id}`} className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Icon name={icon} /> {title}
          </h2>
          <span className="flex flex-wrap items-center gap-1">{badges}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      </header>
      {children}
    </section>
  )
}

interface WorkspaceProps {
  session: Session
  device: DeviceState
  online: boolean
  tools?: ReactNode
  followUp?: ReactNode
}

/** The three-column view: Original, What leaves this device, Explanation. */
export function Workspace({ session, device, online, tools, followUp }: WorkspaceProps) {
  const [picked, setPicked] = useState<Tab | null>(null)
  const { doc, detection } = session
  if (!doc) return null

  // On small screens one column shows at a time. Follow the flow unless the
  // user has picked a tab themselves.
  const tab: Tab = picked ?? (session.hasAnswer || session.busy.includes('explain') || session.busy.includes('strict') ? 'explanation' : 'outbound')

  const detectionSource: BadgeSource = detection?.nanoUsed ? 'on_device' : 'local_code'
  const answerSource = session.explanation?.source ?? session.quick?.source

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col px-3 pb-3 pt-3 sm:px-5 lg:h-[calc(100dvh-3.5rem)]">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name={doc.kind === 'photo' ? 'image' : 'file'} className="shrink-0 text-device-700" />
          <h1 className="truncate text-sm font-semibold">{doc.name}</h1>
          <span className="hidden shrink-0 text-xs text-muted sm:inline">
            {doc.text.length.toLocaleString()} characters
          </span>
        </div>
        <button
          type="button"
          onClick={session.reset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
        >
          <Icon name="refresh" size={13} /> Start over
        </button>
      </div>

      <div role="tablist" aria-label="Document views" className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-stone-200/60 p-1 lg:hidden">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            onClick={() => setPicked(item.id)}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium ${
              tab === item.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
            }`}
          >
            {item.short}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
        <Column
          id="original"
          active={tab}
          title="Original"
          subtitle="Stays on this device. It is never uploaded."
          icon="lock"
          tone="bg-stone-50"
          badges={
            <>
              {doc.kind === 'photo' && <SourceBadge source="on_device" durationMs={doc.transcriptionMs} />}
              {doc.kind === 'pdf' && <SourceBadge source="local_code" />}
            </>
          }
        >
          <OriginalColumn session={session} />
        </Column>

        <Column
          id="outbound"
          active={tab}
          title="What leaves this device"
          subtitle="Only this redacted text is sent, and only when you confirm."
          icon="shield"
          tone="bg-cloud-50/60"
          badges={
            <>
              <SourceBadge source="local_code" />
              {detectionSource === 'on_device' && <SourceBadge source="on_device" />}
            </>
          }
        >
          <OutboundColumn session={session} device={device} online={online} />
        </Column>

        <Column
          id="explanation"
          active={tab}
          title="Explanation"
          subtitle={
            session.strictTrail
              ? 'Written from short answers only. Real names are put back here.'
              : 'Written from the redacted text. Real names are put back here.'
          }
          icon="sparkle"
          tone="bg-device-50/60"
          badges={answerSource ? <SourceBadge source={answerSource} /> : null}
        >
          <ExplanationColumn session={session} device={device} online={online} tools={tools} followUp={followUp} />
        </Column>
      </div>
    </div>
  )
}
