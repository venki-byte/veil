import type { Registry } from '../../privacy/registry'
import { Rehydrated } from './Rehydrated'

interface StreamingTextProps {
  title?: string
  /** Text so far, still containing placeholders. */
  text: string
  registry: Registry
  lang?: string
}

/** An answer that is still being written. Names are restored as it arrives. */
export function StreamingText({ title, text, registry, lang }: StreamingTextProps) {
  return (
    <div className="rounded-lg border border-line bg-white px-3.5 py-3" aria-live="polite" aria-busy="true">
      {title && (
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-stone-900">{title}</h4>
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-device-600" aria-hidden="true" /> Writing
          </span>
        </div>
      )}
      <p lang={lang} className={`whitespace-pre-wrap text-sm leading-relaxed text-stone-800 ${title ? 'mt-2' : ''}`}>
        <Rehydrated text={text} registry={registry} />
        <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-stone-400" aria-hidden="true" />
      </p>
    </div>
  )
}
