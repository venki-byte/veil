import { useState } from 'react'
import { ROUTES } from '../../ai/hybrid'
import { LANGUAGES, type LanguageCode } from '../../ai/prompts'
import { Icon } from '../../components/Icon'
import { ModeChip } from '../../components/RoutingTable'
import { SourceBadge } from '../../components/SourceBadge'
import type { Session, TextResult } from '../session/useSession'
import { Rehydrated } from './Rehydrated'
import { StreamingText } from './StreamingText'

function ResultCard({
  title,
  result,
  session,
  lang,
}: {
  title: string
  result: TextResult
  session: Session
  lang?: string
}) {
  return (
    <div className="fade-in rounded-lg border border-line bg-white px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900">{title}</h4>
        <SourceBadge source={result.source} durationMs={result.durationMs} />
      </div>
      <p lang={lang} className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
        <Rehydrated text={result.text} registry={session.registry} />
      </p>
    </div>
  )
}

const toolButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-device-200 bg-white px-3 py-1.5 text-sm font-medium text-device-700 hover:bg-device-50 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Light tasks on the answer: simpler words, translation, and term
 * definitions. Their input is already redacted, so they prefer the on-device
 * model and fall back to the cloud when it is not available.
 */
export function AnswerTools({ session }: { session: Session }) {
  const [term, setTerm] = useState('')
  const { busy, simple, translations, terms, explanation } = session
  const keyTerms = explanation?.value.keyTerms.slice(0, 6) ?? []
  const pendingTerm = busy.find((key) => key.startsWith('define:'))

  return (
    <section aria-labelledby="tools-title" className="mt-7 rounded-xl border border-line bg-stone-50 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tools-title" className="text-sm font-semibold">
          Make it easier to read
        </h3>
        <ModeChip mode={ROUTES.simplify.mode} />
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{ROUTES.simplify.why}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={toolButton} disabled={busy.includes('simplify')} onClick={() => void session.runSimplify()}>
          <Icon name="sparkle" /> {busy.includes('simplify') ? 'Rewriting' : 'Simpler words'}
        </button>
        {(Object.keys(LANGUAGES) as LanguageCode[]).map((code) => (
          <button
            key={code}
            type="button"
            className={toolButton}
            disabled={busy.includes(`translate:${code}`)}
            onClick={() => void session.runTranslate(code)}
          >
            <Icon name="language" />
            {busy.includes(`translate:${code}`) ? 'Translating' : `Translate to ${LANGUAGES[code].name}`}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void session.runDefine(term)
          setTerm('')
        }}
      >
        <label className="sr-only" htmlFor="term">
          Explain a term
        </label>
        <input
          id="term"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Explain a term, for example “lock-in”"
          maxLength={80}
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-sm placeholder:text-stone-400 focus:border-device-600 focus:outline-none focus:ring-1 focus:ring-device-600"
        />
        <button type="submit" className={toolButton} disabled={term.trim().length < 2 || Boolean(pendingTerm)}>
          Explain
        </button>
      </form>

      {keyTerms.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {keyTerms.map((item) => (
            <button
              key={item.term}
              type="button"
              disabled={Boolean(pendingTerm)}
              onClick={() => void session.runDefine(item.term)}
              className="rounded-full border border-line bg-white px-2.5 py-0.5 text-xs text-stone-700 hover:border-device-600 hover:text-device-700 disabled:opacity-50"
            >
              <Rehydrated text={item.term} registry={session.registry} />
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2" aria-live="polite">
        {pendingTerm && !session.streams[pendingTerm] && (
          <p className="flex items-center gap-2 text-xs font-medium text-device-700" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-device-600" aria-hidden="true" />
            Explaining “{session.registry.rehydrate(pendingTerm.slice('define:'.length))}”
          </p>
        )}
        {busy
          .filter((key) => session.streams[key] && (key === 'simplify' || key.startsWith('translate:') || key.startsWith('define:')))
          .map((key) => {
            const code = key.startsWith('translate:') ? (key.slice('translate:'.length) as LanguageCode) : null
            const title =
              key === 'simplify'
                ? 'In simpler words'
                : code
                  ? `${LANGUAGES[code].native} (${LANGUAGES[code].name})`
                  : `“${session.registry.rehydrate(key.slice('define:'.length))}”`
            return <StreamingText key={key} title={title} text={session.streams[key]} registry={session.registry} lang={code ?? undefined} />
          })}
        {session.toolError && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" /> {session.toolError}
          </p>
        )}
        {Object.entries(terms)
          .reverse()
          .map(([name, result]) => (
            <ResultCard key={name} title={`“${session.registry.rehydrate(name)}”`} result={result} session={session} />
          ))}
        {simple && <ResultCard title="In simpler words" result={simple} session={session} />}
        {(Object.keys(translations) as LanguageCode[]).map((code) => (
          <ResultCard
            key={code}
            title={`${LANGUAGES[code].native} (${LANGUAGES[code].name})`}
            result={translations[code]!}
            session={session}
            lang={code}
          />
        ))}
      </div>
    </section>
  )
}
