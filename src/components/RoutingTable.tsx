import { InferenceMode, MODE_LABELS, ROUTES, type Mode, type Route } from '../ai/hybrid'

const ORDER: Mode[] = [
  InferenceMode.ONLY_ON_DEVICE,
  InferenceMode.ONLY_IN_CLOUD,
  InferenceMode.PREFER_ON_DEVICE,
  InferenceMode.PREFER_IN_CLOUD,
]

const REASON: Record<Mode, string> = {
  [InferenceMode.ONLY_ON_DEVICE]:
    'Raw data must never leave. If Gemini Nano is missing, Veil fails visibly rather than leak.',
  [InferenceMode.ONLY_IN_CLOUD]:
    'Needs strong reasoning and long context. The input is already redacted and has passed the leak guard.',
  [InferenceMode.PREFER_ON_DEVICE]:
    'The input is already redacted, so either path is safe; local is free and instant.',
  [InferenceMode.PREFER_IN_CLOUD]:
    'Best quality when online; still answers from the device when offline.',
}

const TONE: Record<Mode, string> = {
  [InferenceMode.ONLY_ON_DEVICE]: 'bg-device-50 text-device-700 ring-device-200',
  [InferenceMode.PREFER_ON_DEVICE]: 'bg-device-50 text-device-700 ring-device-200',
  [InferenceMode.ONLY_IN_CLOUD]: 'bg-cloud-50 text-cloud-700 ring-cloud-200',
  [InferenceMode.PREFER_IN_CLOUD]: 'bg-cloud-50 text-cloud-700 ring-cloud-200',
}

export function ModeChip({ mode }: { mode: Mode }) {
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium ring-1 ring-inset ${TONE[mode]}`}>
      {MODE_LABELS[mode]}
    </span>
  )
}

/** The four inference modes, the tasks that use each, and the reason. */
export function RoutingTable() {
  const routes: Route[] = Object.values(ROUTES)
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Which inference mode each task uses, and why</caption>
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Mode
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Used for
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Why
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ORDER.map((mode) => (
            <tr key={mode} className="align-top">
              <th scope="row" className="px-4 py-3 font-normal">
                <ModeChip mode={mode} />
              </th>
              <td className="px-4 py-3 text-stone-800">
                {routes
                  .filter((route) => route.mode === mode)
                  .map((route) => route.label)
                  .join(', ')}
                <p className="mt-1 text-xs leading-relaxed text-muted sm:hidden">{REASON[mode]}</p>
              </td>
              <td className="hidden px-4 py-3 leading-relaxed text-muted sm:table-cell">{REASON[mode]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
