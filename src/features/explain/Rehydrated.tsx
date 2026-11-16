import type { Registry } from '../../privacy/registry'

interface RehydratedProps {
  /** Model output that still contains placeholders such as [PERSON_1]. */
  text: string
  registry: Registry
}

/**
 * Renders model output with the real values put back in place of
 * placeholders. This is plain code running in this tab: the cloud only ever
 * saw the placeholders. Restored values are subtly marked.
 */
export function Rehydrated({ text, registry }: RehydratedProps) {
  return (
    <>
      {registry.rehydrateSegments(text).map((segment, index) =>
        segment.entry ? (
          <span
            key={index}
            title={`Restored on this device. The cloud saw ${segment.entry.placeholder}.`}
            className="rounded-sm bg-device-50 px-0.5 text-device-900 underline decoration-device-200 decoration-2 underline-offset-2"
          >
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  )
}
