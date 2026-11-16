import { useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { REDACT_TYPES, TYPE_LABELS, type SensitiveType } from '../../privacy/types'
import type { Session } from '../session/useSession'

/** A first guess at the type of a manually selected phrase. The user can change it. */
function guessType(text: string): SensitiveType {
  const digits = text.replace(/\D/g, '').length
  if (text.includes('@')) return 'CONTACT'
  if (digits >= 8 && digits / text.length > 0.6) return 'ACCOUNT'
  if (digits >= 3 && !/\s/.test(text)) return 'ID'
  if (digits > 0 || text.includes(',')) return 'ADDRESS'
  return 'PERSON'
}

/**
 * Column 1: the original document. It never leaves the device.
 * Hidden details are highlighted; selecting any text offers to hide it.
 */
export function OriginalColumn({ session }: { session: Session }) {
  const { doc, registry, version } = session
  const container = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<{ text: string; type: SensitiveType } | null>(null)

  const segments = useMemo(
    () => (doc ? registry.segments(doc.text, true) : []),
    // `version` changes whenever the registry is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, registry, version],
  )

  if (!doc) return null

  const readSelection = () => {
    const current = window.getSelection()
    const text = current?.toString().replace(/\s+/g, ' ').trim() ?? ''
    const inside = current?.anchorNode && container.current?.contains(current.anchorNode)
    if (inside && text.length >= 2 && text.length <= 160) setSelection({ text, type: guessType(text) })
    else setSelection(null)
  }

  const hideSelection = () => {
    if (!selection) return
    session.addManual(selection.text, selection.type)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {doc.imageUrl && (
          <figure className="mb-4 overflow-hidden rounded-lg border border-line bg-stone-50">
            <img src={doc.imageUrl} alt="The photo you opened" className="max-h-56 w-full object-contain" />
            <figcaption className="flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-xs text-muted">
              <Icon name="lock" size={12} /> This photo was read by Gemini Nano on this device and was never uploaded.
              Photo reading is in beta: check the text below against the page.
            </figcaption>
          </figure>
        )}
        <div
          ref={container}
          onMouseUp={readSelection}
          onKeyUp={readSelection}
          className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-stone-800"
        >
          {segments.map((segment, index) =>
            segment.entry ? (
              <mark
                key={index}
                role="button"
                tabIndex={0}
                aria-pressed={segment.entry.enabled}
                title={
                  segment.entry.enabled
                    ? `Hidden as ${segment.entry.placeholder}. Click to leave it visible.`
                    : `${TYPE_LABELS[segment.entry.type]}, left visible. Click to hide it.`
                }
                onClick={() => session.setEntryEnabled(segment.entry!.id, !segment.entry!.enabled)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    session.setEntryEnabled(segment.entry!.id, !segment.entry!.enabled)
                  }
                }}
                className={
                  segment.entry.enabled
                    ? 'cursor-pointer rounded-sm bg-amber-200/70 px-0.5 text-stone-900 decoration-clone hover:bg-amber-300/80'
                    : 'cursor-pointer rounded-sm bg-transparent px-0.5 text-stone-800 underline decoration-stone-400 decoration-dashed underline-offset-2 hover:bg-stone-100'
                }
              >
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </div>
      </div>

      <div className="border-t border-line bg-stone-50 px-4 py-2.5 text-xs" aria-live="polite">
        {selection ? (
          <form
            className="fade-in flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              hideSelection()
            }}
          >
            <span className="min-w-0 flex-1 truncate text-stone-800">
              Hide “<span className="font-medium">{selection.text}</span>” as
            </span>
            <select
              aria-label="Type of detail"
              value={selection.type}
              onChange={(event) => setSelection({ ...selection, type: event.target.value as SensitiveType })}
              className="rounded-md border border-line bg-white px-1.5 py-1 text-xs"
            >
              {REDACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-device-700 px-2.5 py-1 font-semibold text-white hover:bg-device-900">
              <Icon name="eyeOff" size={13} /> Hide everywhere
            </button>
          </form>
        ) : (
          <p className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-amber-200" aria-hidden="true" />
            Highlighted text is hidden. Select any other text to hide it too, or click a highlight to show it.
          </p>
        )}
      </div>
    </div>
  )
}
