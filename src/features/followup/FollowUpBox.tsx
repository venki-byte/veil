import { useState } from 'react'
import { ROUTES } from '../../ai/hybrid'
import { Icon } from '../../components/Icon'
import { ModeChip } from '../../components/RoutingTable'
import { SourceBadge } from '../../components/SourceBadge'
import { Rehydrated } from '../explain/Rehydrated'
import type { Session } from '../session/useSession'

/**
 * Follow-up questions. Each question is redacted with the same registry and
 * passes the leak guard before it is sent; the answer is rehydrated locally.
 */
export function FollowUpBox({ session, online }: { session: Session; online: boolean }) {
  const [question, setQuestion] = useState('')
  const asking = session.busy.includes('ask')

  return (
    <section aria-labelledby="followup-title" className="mt-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="followup-title" className="text-sm font-semibold">
          Ask a follow-up question
        </h3>
        <ModeChip mode={session.strictTrail ? ROUTES.followUpOnDevice.mode : ROUTES.followUp.mode} />
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        {session.strictTrail ? (
          'This explanation was made in strict mode, so follow-up questions are answered by Gemini Nano on this device. The document still never leaves.'
        ) : (
          <>
            Names and numbers in your question are swapped for the same placeholders before it is sent.
            {!online && ' You are offline, so Gemini Nano will answer on this device.'}
          </>
        )}
      </p>

      {session.followUps.length > 0 && (
        <ol className="mt-3 flex flex-col gap-3" aria-live="polite">
          {session.followUps.map((item) => (
            <li key={item.id} className="fade-in">
              <p className="ml-6 rounded-xl rounded-br-sm bg-device-900 px-3.5 py-2 text-sm leading-relaxed text-white">
                {item.question}
              </p>
              {item.redactedQuestion !== item.question && (
                <p className="ml-6 mt-1 text-right font-mono text-[11px] leading-relaxed text-cloud-700">
                  Sent as: {item.redactedQuestion}
                </p>
              )}
              <div className="mr-6 mt-1.5 rounded-xl rounded-bl-sm border border-line bg-white px-3.5 py-2.5">
                {item.status === 'pending' && (
                  <p className="flex items-center gap-2 text-sm text-muted" role="status">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-cloud-600" aria-hidden="true" /> Thinking
                  </p>
                )}
                {item.status === 'error' && (
                  <p className="flex items-start gap-2 text-sm leading-relaxed text-rose-800">
                    <Icon name="alert" className="mt-0.5 shrink-0" /> {item.error}
                  </p>
                )}
                {item.status === 'done' && item.answer && (
                  <>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
                      <Rehydrated text={item.answer.text} registry={session.registry} />
                    </p>
                    <p className="mt-2">
                      <SourceBadge source={item.answer.source} durationMs={item.answer.durationMs} />
                    </p>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!question.trim() || asking) return
          void session.ask(question)
          setQuestion('')
        }}
      >
        <label className="sr-only" htmlFor="question">
          Your question about this document
        </label>
        <input
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this document"
          maxLength={400}
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-device-600 focus:outline-none focus:ring-1 focus:ring-device-600"
        />
        <button
          type="submit"
          disabled={!question.trim() || asking}
          className="inline-flex items-center gap-1.5 rounded-lg bg-device-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-device-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="send" /> Ask
        </button>
      </form>
    </section>
  )
}
