import type { ReactNode } from 'react'
import { ROUTES, type DeviceState } from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { SourceBadge } from '../../components/SourceBadge'
import type { Session } from '../session/useSession'
import { StrictProgress, StrictTrailPanel } from '../strict/StrictPanels'
import { Rehydrated } from './Rehydrated'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Waiting({ session }: { session: Session }) {
  const detecting = session.detection?.running
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <span className="rounded-full bg-stone-100 p-3 text-stone-500">
        <Icon name="sparkle" size={24} />
      </span>
      <h3 className="mt-4 font-serif text-xl text-device-900">
        {detecting ? 'Finding personal details on this device' : 'Nothing has been sent yet'}
      </h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
        {detecting
          ? 'Gemini Nano is reading the document locally. You can already see what the patterns found.'
          : 'Check the middle column. When you are happy with what it shows, send the redacted text and the explanation will appear here with the real names put back.'}
      </p>
      <ol className="mt-6 w-full max-w-xs space-y-2 text-left text-xs text-stone-700">
        {[
          ['on_device', 'Detect and redact'],
          ['local_code', 'Leak guard check'],
          ['in_cloud', 'Explain redacted text'],
          ['local_code', 'Restore real values'],
        ].map(([source, label]) => (
          <li key={label} className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2">
            {label}
            <SourceBadge source={source as 'on_device' | 'in_cloud' | 'local_code'} />
          </li>
        ))}
      </ol>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="px-5 py-6" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium text-cloud-700">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cloud-600" aria-hidden="true" />
        {label}
      </p>
      <div className="mt-5 animate-pulse space-y-3" aria-hidden="true">
        <div className="h-6 w-2/3 rounded bg-stone-200" />
        <div className="h-3 w-full rounded bg-stone-200" />
        <div className="h-3 w-11/12 rounded bg-stone-200" />
        <div className="h-3 w-4/5 rounded bg-stone-200" />
        <div className="mt-6 h-20 w-full rounded-lg bg-stone-100" />
        <div className="h-20 w-full rounded-lg bg-stone-100" />
      </div>
    </div>
  )
}

interface ExplanationColumnProps {
  session: Session
  device: DeviceState
  online: boolean
  /** Rendered under the answer: the light tools. */
  tools?: ReactNode
  /** Rendered at the bottom: follow-up questions. */
  followUp?: ReactNode
}

/**
 * Column 3: the explanation. The cloud wrote it using placeholders; the real
 * values shown here were put back by plain code on this device.
 */
export function ExplanationColumn({ session, online, tools, followUp }: ExplanationColumnProps) {
  const { explanation, quick, registry } = session
  const explaining = session.busy.includes('explain')
  const quickReading = session.busy.includes('quick')
  const strictRunning = session.busy.includes('strict')

  if (!session.hasAnswer) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {strictRunning ? (
          <StrictProgress step={session.strictStep} />
        ) : explaining ? (
          <Loading label="Cloud Gemini is reading the redacted text" />
        ) : quickReading ? (
          <Loading label="Gemini Nano is writing a quick read on this device" />
        ) : (
          <Waiting session={session} />
        )}
      </div>
    )
  }

  const result = explanation?.value

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      {strictRunning && (
        <div className="-mx-5 -mt-5 mb-5 border-b border-line bg-stone-50">
          <StrictProgress step={session.strictStep} />
        </div>
      )}
      {result && explanation ? (
        <article className="fade-in">
          <header>
            <div className="flex flex-wrap items-center gap-1.5">
              {session.strictTrail && (
                <span className="inline-flex items-center gap-1 rounded-full bg-device-900 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-white">
                  <Icon name="lock" size={12} /> STRICT
                </span>
              )}
              <SourceBadge source={explanation.source} durationMs={explanation.durationMs} />
              <SourceBadge source="local_code" />
              <span className="text-[11px] text-muted">names restored here</span>
            </div>
            <h2 className="mt-2.5 font-serif text-2xl leading-snug text-device-900">
              <Rehydrated text={result.documentType} registry={registry} />
            </h2>
          </header>

          <p className="mt-3 text-[15px] leading-relaxed text-stone-800">
            <Rehydrated text={result.summary} registry={registry} />
          </p>

          {session.strictTrail && <StrictTrailPanel trail={session.strictTrail} />}

          {result.thingsToWatch.length > 0 && (
            <Section title="Things to watch">
              <ul className="space-y-2">
                {result.thingsToWatch.map((item, index) => (
                  <li key={index} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-3">
                    <p className="text-sm font-semibold text-stone-900">
                      <Rehydrated text={item.title} registry={registry} />
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-stone-700">
                      <Rehydrated text={item.detail} registry={registry} />
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {result.deadlinesAndAmounts.length > 0 && (
            <Section title="Deadlines and amounts">
              <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
                {result.deadlinesAndAmounts.map((item, index) => (
                  <div key={index} className="grid grid-cols-5 gap-3 px-3.5 py-2.5 text-sm">
                    <dt className="col-span-2 text-stone-600">
                      <Rehydrated text={item.label} registry={registry} />
                    </dt>
                    <dd className="col-span-3">
                      <span className="font-semibold text-stone-900">
                        <Rehydrated text={item.value} registry={registry} />
                      </span>
                      {item.note && (
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                          <Rehydrated text={item.note} registry={registry} />
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {result.keyTerms.length > 0 && (
            <Section title="Key terms">
              <dl className="space-y-2.5">
                {result.keyTerms.map((item, index) => (
                  <div key={index} className="text-sm leading-relaxed">
                    <dt className="inline font-semibold text-stone-900">
                      <Rehydrated text={item.term} registry={registry} />
                    </dt>
                    <dd className="inline text-stone-700">
                      {': '}
                      <Rehydrated text={item.meaning} registry={registry} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {result.questionsToAsk.length > 0 && (
            <Section title="Questions you could ask">
              <ul className="space-y-1.5">
                {result.questionsToAsk.map((question, index) => (
                  <li key={index} className="flex gap-2 text-sm leading-relaxed text-stone-800">
                    <Icon name="question" className="mt-1 shrink-0 text-device-600" size={14} />
                    <span>
                      <Rehydrated text={question} registry={registry} />
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </article>
      ) : (
        quick && (
          <article className="fade-in">
            <div className="flex flex-wrap items-center gap-1.5">
              <SourceBadge source={quick.source} durationMs={quick.durationMs} />
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700">Lighter answer</span>
            </div>
            <h2 className="mt-2.5 font-serif text-2xl text-device-900">Quick read</h2>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-800">
              <Rehydrated text={quick.text} registry={registry} />
            </p>
            {session.quickTruncated && (
              <p className="mt-2 text-xs text-muted">This quick read covers the first part of a long document.</p>
            )}
            <div className="mt-4 rounded-lg border border-cloud-200 bg-cloud-50 px-3.5 py-3 text-sm">
              <p className="leading-relaxed text-stone-700">
                {ROUTES.quickRead.why} The full explanation adds key terms, things to watch, deadlines and questions to ask.
              </p>
              {explaining ? (
                <p className="mt-2 flex items-center gap-2 font-medium text-cloud-700" role="status">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-cloud-600" aria-hidden="true" />
                  Cloud Gemini is reading the redacted text
                </p>
              ) : online ? (
                <button
                  type="button"
                  onClick={() => void session.explain()}
                  className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-cloud-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-cloud-700"
                >
                  <Icon name="send" /> Get the full explanation
                </button>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-stone-700">
                  <Icon name="offline" size={13} /> Available when you are back online.
                </p>
              )}
            </div>
          </article>
        )
      )}

      {tools}
      {followUp}

      <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        Veil explains what a document says. It does not give medical, legal or financial advice, and it can be wrong.
        For decisions, talk to a qualified professional.
      </p>
    </div>
  )
}
