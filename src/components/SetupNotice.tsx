import { Icon } from './Icon'

/** Shown when the Firebase config is missing from .env. */
export function SetupNotice() {
  return (
    <section
      role="alert"
      className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-900"
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon name="alert" /> Firebase is not configured yet
      </h2>
      <p className="mt-1.5">
        Veil runs every model call through Firebase AI Logic, so it needs your Firebase web app config before any
        AI step can run. You can still load a document and see pattern-based redaction.
      </p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5">
        <li>
          Copy <code className="rounded bg-rose-100 px-1">.env.example</code> to{' '}
          <code className="rounded bg-rose-100 px-1">.env</code>.
        </li>
        <li>Paste the values from Firebase console, Project settings, Your apps, Web app.</li>
        <li>Restart the dev server.</li>
      </ol>
    </section>
  )
}
