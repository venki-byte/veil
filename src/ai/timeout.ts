/**
 * Time limits for model calls. Plain code, unit tested.
 *
 * The cloud SDK has its own request timeout (set per call in hybrid.ts), but
 * the on-device model does not. A small model can occasionally run away and
 * keep writing until it hits its output limit, which took more than five
 * minutes in testing. A time limit stops Veil from waiting on it; the next
 * on-device call replaces the stuck session.
 */

export class ModelTimeoutError extends Error {
  readonly ms: number

  constructor(ms: number) {
    super(`The model took longer than ${Math.round(ms / 1000)} seconds and was stopped.`)
    this.name = 'ModelTimeoutError'
    this.ms = ms
  }
}

/** Resolves or rejects with `work`, or rejects with ModelTimeoutError after `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ModelTimeoutError(ms)), ms)
  })
  return Promise.race([work, limit]).finally(() => clearTimeout(timer))
}
