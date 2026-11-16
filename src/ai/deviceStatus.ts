/**
 * Tracks whether the on-device model (Gemini Nano) is usable.
 *
 * Veil never calls the browser's Prompt API directly. The only way it learns
 * about the model is the Hybrid Inference SDK's `initializeDeviceModel()`,
 * which src/ai/hybrid.ts passes in here as `initialise`:
 *
 *   - it resolves at once when the model is already on the device,
 *   - it rejects with NotAllowedError when a download is needed but there
 *     has been no click yet (the browser only starts a download on a user
 *     action), and
 *   - it rejects with another error when the browser cannot run the model.
 *
 * This file contains no SDK import, so the logic is plain code and is unit
 * tested with a fake `initialise`.
 */

export type DeviceStatus = 'checking' | 'unavailable' | 'downloadable' | 'downloading' | 'ready'

export interface DeviceState {
  status: DeviceStatus
  /** Whether on-device image input (photo transcription) is usable. */
  image: boolean
  /** Download progress from 0 to 1 while downloading, otherwise null. */
  progress: number | null
  error: string | null
}

export interface DeviceDeps {
  /** Feature detection only: does this browser expose an on-device model at all? */
  hasOnDeviceApi: () => boolean
  /** Whether the Firebase config is present, so the SDK can be used. */
  configured: boolean
  /**
   * Calls the SDK's `initializeDeviceModel()` for a text-only or a
   * text-and-image model. Resolves when that model is ready to use.
   */
  initialise: (withImage: boolean, onProgress?: (progress: number) => void) => Promise<void>
  /** Turns an error into a sentence for the UI. */
  describeError: (error: unknown) => string
  /** How long a status check may take before the app stops waiting for it. */
  timeoutMs?: number
  /** How long a "ready" result is trusted before it is checked again. */
  freshForMs?: number
  now?: () => number
}

type Outcome = 'ready' | 'needs-click' | 'unavailable'

/**
 * A download that needs a click is reported by the browser as
 * NotAllowedError. Anything else means the model cannot run here.
 */
export function classifyInitialiseError(error: unknown): Exclude<Outcome, 'ready'> {
  const name = (error as { name?: unknown } | null)?.name
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (name === 'NotAllowedError' || /user (activation|gesture)|transient activation|not allowed/i.test(message)) {
    return 'needs-click'
  }
  return 'unavailable'
}

export function createDeviceStore(deps: DeviceDeps) {
  const timeoutMs = deps.timeoutMs ?? 8000
  const freshForMs = deps.freshForMs ?? 30_000
  const now = deps.now ?? (() => Date.now())

  let state: DeviceState = { status: 'checking', image: false, progress: null, error: null }
  const listeners = new Set<() => void>()
  let settingUp = false
  let checking: Promise<DeviceState> | null = null
  let lastReadyAt = Number.NEGATIVE_INFINITY

  const set = (patch: Partial<DeviceState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const attempt = async (withImage: boolean, onProgress?: (progress: number) => void): Promise<Outcome> => {
    try {
      await deps.initialise(withImage, onProgress)
      return 'ready'
    } catch (error) {
      return classifyInitialiseError(error)
    }
  }

  const markReady = async () => {
    // Photo input is a separate capability behind a Chrome flag.
    const image = (await attempt(true)) === 'ready'
    lastReadyAt = now()
    set({ status: 'ready', image, progress: null, error: null })
  }

  const check = async (): Promise<DeviceState> => {
    if (!deps.hasOnDeviceApi()) {
      set({ status: 'unavailable', image: false, progress: null })
      return state
    }
    if (!deps.configured) {
      // Without Firebase config the SDK cannot be asked. Offer setup; the
      // button explains what is missing.
      set({ status: 'downloadable', image: false, progress: null })
      return state
    }

    let sawProgress = false
    const outcome = attempt(false, (progress) => {
      sawProgress = true
      set({ status: 'downloading', progress })
    })
    const timedOut = Symbol('timed out')
    const first = await Promise.race([
      outcome,
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), timeoutMs)),
    ])

    if (first === timedOut) {
      // Still waiting: either Chrome is downloading the model, or it is not
      // answering. Never hold the app up; pick the state that fits and let
      // the late answer correct it.
      if (!sawProgress) set({ status: 'unavailable', image: false, progress: null })
      void outcome.then((late) => {
        if (late === 'ready' && !settingUp) void markReady()
      })
      return state
    }

    if (first === 'ready') await markReady()
    else if (first === 'needs-click') set({ status: 'downloadable', image: false, progress: null })
    else set({ status: 'unavailable', image: false, progress: null })
    return state
  }

  /**
   * Re-checks the model when that is useful and safe:
   *   - the first time,
   *   - when a "ready" result has gone stale (the browser can evict the model).
   * A model that needs a click is not re-checked here, because the check
   * itself could start a download; that only happens from `setUp`.
   */
  const refresh = (force = false): Promise<DeviceState> => {
    if (settingUp) return Promise.resolve(state)
    if (checking) return checking

    const stale = state.status === 'ready' && now() - lastReadyAt >= freshForMs
    if (!force && state.status !== 'checking' && !stale) return Promise.resolve(state)

    checking = check().finally(() => {
      checking = null
    })
    return checking
  }

  /**
   * Downloads and prepares the model. Must be called from a user action such
   * as a button click. The first download can take several minutes.
   */
  const setUp = async (): Promise<DeviceState> => {
    if (settingUp) return state
    if (!deps.hasOnDeviceApi()) {
      set({ status: 'unavailable', image: false, progress: null })
      return state
    }
    settingUp = true
    set({ status: 'downloading', progress: 0, error: null })
    const onProgress = (progress: number) => set({ progress })

    try {
      try {
        // One download covers text and photo tasks when image input is on.
        await deps.initialise(true, onProgress)
      } catch (error) {
        if (classifyInitialiseError(error) === 'needs-click') throw error
        // Image input is not available here: set up the text-only model.
        await deps.initialise(false, onProgress)
      }
      settingUp = false
      await markReady()
    } catch (error) {
      settingUp = false
      const outcome = classifyInitialiseError(error)
      set({
        status: outcome === 'needs-click' ? 'downloadable' : 'unavailable',
        image: false,
        progress: null,
        error: deps.describeError(error),
      })
    }
    return state
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh,
    setUp,
  }
}
