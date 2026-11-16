import { useRef, useState, type DragEvent } from 'react'
import type { DeviceState } from '../../ai/hybrid'
import { PrivateModeCard } from '../../components/DeviceStatus'
import { Icon } from '../../components/Icon'
import { RoutingTable } from '../../components/RoutingTable'
import { SetupNotice } from '../../components/SetupNotice'
import { SourceBadge } from '../../components/SourceBadge'
import { firebaseConfigured } from '../../firebase'
import type { Session } from '../session/useSession'
import { SAMPLES } from './samples'

const STEPS = [
  {
    title: 'Your device reads it',
    body: 'Gemini Nano, running inside Chrome, finds names, addresses, ID numbers and other personal details. Plain code swaps each one for a placeholder like [PERSON_1].',
    badge: 'on_device' as const,
  },
  {
    title: 'The cloud explains the redacted text',
    body: 'You see exactly what will be sent and can change it. A leak guard blocks the request if any hidden value is still in it. Cloud Gemini only ever sees placeholders.',
    badge: 'in_cloud' as const,
  },
  {
    title: 'Your device puts the names back',
    body: 'The answer comes back with placeholders. Plain code in this tab restores the real values, so you read a normal explanation that the cloud never saw.',
    badge: 'local_code' as const,
  },
]

interface IngestPanelProps {
  session: Session
  device: DeviceState
}

export function IngestPanel({ session, device }: IngestPanelProps) {
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const photosReady = device.status === 'ready' && device.image

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void session.loadFile(file)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <div className="max-w-3xl">
        <h1 className="font-serif text-4xl leading-tight text-device-900 sm:text-5xl">
          Understand the paperwork.
          <br />
          Keep the personal details.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Veil explains lab reports, agreements, and bank and tax letters in plain language. Your names, numbers
          and addresses are replaced on this device before anything is sent, and put back on this device afterwards.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {!firebaseConfigured && <SetupNotice />}
        <PrivateModeCard device={device} />
        {session.error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <Icon name="alert" className="mt-0.5 shrink-0" />
            <p className="flex-1 leading-relaxed">{session.error}</p>
            <button type="button" onClick={session.dismissError} aria-label="Dismiss" className="rounded p-0.5 hover:bg-rose-100">
              <Icon name="close" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section
          aria-label="Open a file"
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? 'border-device-600 bg-device-50' : 'border-stone-300 bg-white'
          }`}
        >
          <span className="rounded-full bg-device-50 p-3 text-device-700">
            <Icon name="upload" size={24} />
          </span>
          <h2 className="mt-3 text-base font-semibold">Drop a document here</h2>
          <p className="mt-1 text-sm text-muted">PDF, text file, or a JPEG or PNG photo of a page</p>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.md,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void session.loadFile(file)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="mt-4 rounded-lg bg-device-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-device-900"
          >
            Choose a file
          </button>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
            <Icon name="lock" size={12} /> The file is opened in this tab and is never uploaded.
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <Icon name="image" size={12} />
            {photosReady
              ? 'Photos are read by Gemini Nano on this device (beta).'
              : 'Photos need Gemini Nano with image input, so they are switched off for now.'}
          </p>
        </section>

        <section aria-label="Paste text" className="flex flex-col rounded-2xl border border-line bg-white p-4">
          <label htmlFor="paste" className="text-sm font-semibold">
            Or paste the text
          </label>
          <textarea
            id="paste"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste the text of a report, agreement or letter here."
            className="mt-2 min-h-40 flex-1 resize-y rounded-lg border border-line bg-paper/50 p-3 font-mono text-[13px] leading-relaxed placeholder:font-sans placeholder:text-stone-400 focus:border-device-600 focus:outline-none focus:ring-1 focus:ring-device-600"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Nothing is sent when you continue. You review the redaction first.</p>
            <button
              type="button"
              disabled={text.trim().length < 20}
              onClick={() => void session.loadText(text)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-device-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-device-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue <Icon name="arrowRight" />
            </button>
          </div>
        </section>
      </div>

      <section aria-labelledby="samples-title" className="mt-8">
        <h2 id="samples-title" className="text-sm font-semibold">
          Try a sample document
        </h2>
        <p className="mt-0.5 text-xs text-muted">Every person, number and address in the samples is invented.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => session.loadSample(sample.id)}
              className="group rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-device-600 hover:shadow"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <Icon name={sample.icon} className="text-device-700" /> {sample.title}
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-muted">{sample.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-title" className="mt-14">
        <h2 id="how-title" className="font-serif text-2xl text-device-900">
          How Veil keeps the split honest
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-line bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="font-serif text-2xl text-stone-300">{index + 1}</span>
                <SourceBadge source={step.badge} />
              </div>
              <h3 className="mt-2 text-sm font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="routing-title" className="mt-12">
        <h2 id="routing-title" className="font-serif text-2xl text-device-900">
          Four inference modes, four reasons
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
          The device and cloud split is the privacy mechanism, not a fallback. Every result in Veil carries a badge
          showing where it actually ran, and the privacy ledger lists every call.
        </p>
        <div className="mt-4">
          <RoutingTable />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <a href="#/routing" className="inline-flex items-center gap-1.5 text-sm font-medium text-device-700 hover:underline">
            Run one call in each mode and see where it runs <Icon name="arrowRight" />
          </a>
          <a href="#/eval" className="inline-flex items-center gap-1.5 text-sm font-medium text-device-700 hover:underline">
            Run the leak test on ten synthetic documents <Icon name="arrowRight" />
          </a>
        </div>
      </section>

      <p className="mt-12 border-t border-line pt-5 text-xs leading-relaxed text-muted">
        Veil explains documents. It does not give medical, legal or financial advice. Automatic redaction can miss
        things, which is why you always review what will be sent. For decisions, talk to a qualified professional.
      </p>
    </div>
  )
}
