import type { StrictStep } from '../../ai/strict'
import { Icon } from '../../components/Icon'
import { SourceBadge, type BadgeSource } from '../../components/SourceBadge'
import type { StrictTrail } from '../session/useSession'

const STEPS: Array<{ id: StrictStep['step']; label: string; source: BadgeSource }> = [
  { id: 'classify', label: 'Gemini Nano names the kind of document', source: 'on_device' },
  { id: 'plan', label: 'The cloud sees only that label and writes questions', source: 'in_cloud' },
  { id: 'answer', label: 'Gemini Nano answers them from your document', source: 'on_device' },
  { id: 'combine', label: 'The cloud explains from the short answers', source: 'in_cloud' },
]

/** Live progress through the four strict mode steps. */
export function StrictProgress({ step }: { step: StrictStep | null }) {
  const current = step ? STEPS.findIndex((item) => item.id === step.step) : 0
  return (
    <div className="px-5 py-6" role="status" aria-live="polite">
      <h3 className="flex items-center gap-2 font-serif text-xl text-device-900">
        <Icon name="lock" /> Strict mode is running
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Your document stays on this device for the whole run. The cloud is asked twice, and never receives the text.
      </p>
      <ol className="mt-4 space-y-2">
        {STEPS.map((item, index) => {
          const state = index < current ? 'done' : index === current ? 'active' : 'waiting'
          return (
            <li
              key={item.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                state === 'active' ? 'border-device-600 bg-device-50' : 'border-line bg-white'
              } ${state === 'waiting' ? 'text-stone-400' : 'text-stone-800'}`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {state === 'done' ? (
                  <Icon name="check" className="shrink-0 text-device-600" />
                ) : state === 'active' ? (
                  <span className="mx-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-device-600" aria-hidden="true" />
                ) : (
                  <span className="mx-1 h-2 w-2 shrink-0 rounded-full bg-stone-300" aria-hidden="true" />
                )}
                <span>
                  {item.label}
                  {state === 'active' && step?.step === 'answer' && step.total > 0 && (
                    <span className="text-muted">
                      {' '}
                      (part {Math.min(step.done + 1, step.total)} of {step.total}, {step.questions} questions)
                    </span>
                  )}
                  {state !== 'waiting' && step && 'documentType' in step && item.id === 'classify' && (
                    <span className="text-muted">: “{step.documentType}”</span>
                  )}
                </span>
              </span>
              <SourceBadge source={item.source} className={state === 'waiting' ? 'opacity-50' : ''} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Shows exactly what the cloud was given in place of the document. */
export function StrictTrailPanel({ trail }: { trail: StrictTrail }) {
  const sentChars = trail.facts.reduce((sum, fact) => sum + fact.answer.length, 0)
  return (
    <details className="mt-4 rounded-lg border border-device-200 bg-device-50/70 text-sm">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3.5 py-2.5 font-medium text-device-900">
        <Icon name="lock" className="shrink-0" />
        Strict mode: the cloud never received your document
      </summary>
      <div className="border-t border-device-200 px-3.5 py-3">
        <p className="leading-relaxed text-stone-700">
          Instead of the text, the cloud was given the kind of document and {trail.facts.length} short answers written
          by Gemini Nano on this device ({sentChars.toLocaleString()} characters in total). This is all of it:
        </p>
        <p className="mt-2.5 text-xs uppercase tracking-wide text-muted">Kind of document</p>
        <p className="font-mono text-[12.5px] text-stone-900">{trail.documentType}</p>
        <p className="mt-2.5 text-xs uppercase tracking-wide text-muted">Questions the cloud wrote, and the answers it received</p>
        <dl className="mt-1 space-y-2">
          {trail.facts.map((fact) => (
            <div key={fact.id}>
              <dt className="text-[13px] text-stone-600">{fact.question}</dt>
              <dd className="font-mono text-[12.5px] leading-relaxed text-stone-900">{fact.answer}</dd>
            </div>
          ))}
        </dl>
        {trail.failedChunks > 0 && (
          <p className="mt-2.5 text-xs text-amber-700">
            Gemini Nano could not answer from {trail.failedChunks} part{trail.failedChunks === 1 ? '' : 's'} of the
            document, so this explanation may be missing details from there.
          </p>
        )}
        <p className="mt-2.5 text-xs leading-relaxed text-muted">
          A strict mode explanation is built from less information, so it can be thinner than the standard one. The
          privacy ledger shows both cloud requests in full.
        </p>
      </div>
    </details>
  )
}
