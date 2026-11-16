import { describe, expect, it, vi } from 'vitest'
import { classifyInitialiseError, createDeviceStore, type DeviceDeps } from './deviceStatus'

/** The error a browser raises when a download needs a click first. */
const needsClick = () => Object.assign(new Error('Requires a user gesture'), { name: 'NotAllowedError' })
const notSupported = () => Object.assign(new Error('Local LanguageModel API not available'), { name: 'AIError' })

type Initialise = DeviceDeps['initialise']

function build(initialise: Initialise, overrides: Partial<DeviceDeps> = {}) {
  let time = 0
  const store = createDeviceStore({
    hasOnDeviceApi: () => true,
    configured: true,
    initialise,
    describeError: (error) => (error instanceof Error ? error.message : 'error'),
    timeoutMs: 50,
    freshForMs: 1000,
    now: () => time,
    ...overrides,
  })
  return { store, advance: (ms: number) => (time += ms) }
}

describe('classifyInitialiseError', () => {
  it('treats NotAllowedError as "a click is needed"', () => {
    expect(classifyInitialiseError(needsClick())).toBe('needs-click')
    expect(classifyInitialiseError(new Error('Model download requires user activation.'))).toBe('needs-click')
  })

  it('treats everything else as unavailable', () => {
    expect(classifyInitialiseError(notSupported())).toBe('unavailable')
    expect(classifyInitialiseError(null)).toBe('unavailable')
    expect(classifyInitialiseError('boom')).toBe('unavailable')
  })
})

describe('device store: first check', () => {
  it('starts in "checking"', () => {
    const { store } = build(async () => {})
    expect(store.getState().status).toBe('checking')
  })

  it('is unavailable when the browser has no on-device model, without asking the SDK', async () => {
    const initialise = vi.fn<Initialise>(async () => {})
    const { store } = build(initialise, { hasOnDeviceApi: () => false })
    expect((await store.refresh()).status).toBe('unavailable')
    expect(initialise).not.toHaveBeenCalled()
  })

  it('offers setup without asking the SDK when Firebase is not configured', async () => {
    const initialise = vi.fn<Initialise>(async () => {})
    const { store } = build(initialise, { configured: false })
    expect((await store.refresh()).status).toBe('downloadable')
    expect(initialise).not.toHaveBeenCalled()
  })

  it('is ready, with image input, when both models initialise', async () => {
    const { store } = build(async () => {})
    expect(await store.refresh()).toEqual({ status: 'ready', image: true, progress: null, error: null })
  })

  it('is ready without image input when only the text model initialises', async () => {
    const { store } = build(async (withImage) => {
      if (withImage) throw notSupported()
    })
    const state = await store.refresh()
    expect(state.status).toBe('ready')
    expect(state.image).toBe(false)
  })

  it('needs a click when the download has not started', async () => {
    const { store } = build(async () => {
      throw needsClick()
    })
    expect((await store.refresh()).status).toBe('downloadable')
  })

  it('is unavailable when the SDK says the model cannot run', async () => {
    const { store } = build(async () => {
      throw notSupported()
    })
    expect((await store.refresh()).status).toBe('unavailable')
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { store } = build(async () => {})
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    await store.refresh()
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    unsubscribe()
    await store.refresh(true)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('device store: a check that does not answer', () => {
  it('stops waiting, reports unavailable, and corrects itself if the answer arrives late', async () => {
    let finish: () => void = () => {}
    const { store } = build((withImage) => (withImage ? Promise.resolve() : new Promise<void>((resolve) => (finish = resolve))))

    expect((await store.refresh()).status).toBe('unavailable')
    finish()
    await vi.waitFor(() => expect(store.getState().status).toBe('ready'))
  })

  it('reports "downloading" when progress arrives while waiting', async () => {
    const { store } = build((_withImage, onProgress) => {
      onProgress?.(0.4)
      return new Promise<void>(() => {})
    })
    const state = await store.refresh()
    expect(state.status).toBe('downloading')
    expect(state.progress).toBe(0.4)
  })
})

describe('device store: when to check again', () => {
  it('does not ask the SDK again while a "ready" result is fresh', async () => {
    const initialise = vi.fn<Initialise>(async () => {})
    const { store, advance } = build(initialise)
    await store.refresh()
    const calls = initialise.mock.calls.length

    advance(500)
    await store.refresh()
    expect(initialise).toHaveBeenCalledTimes(calls)
  })

  it('checks again once a "ready" result is stale, and notices an evicted model', async () => {
    let evicted = false
    const { store, advance } = build(async () => {
      if (evicted) throw needsClick()
    })
    expect((await store.refresh()).status).toBe('ready')

    evicted = true
    advance(1500)
    expect((await store.refresh()).status).toBe('downloadable')
  })

  it('never re-checks a model that needs a click, so no download starts by accident', async () => {
    const initialise = vi.fn<Initialise>(async () => {
      throw needsClick()
    })
    const { store, advance } = build(initialise)
    await store.refresh()
    const calls = initialise.mock.calls.length

    advance(60_000)
    await store.refresh()
    await store.refresh()
    expect(initialise).toHaveBeenCalledTimes(calls)
  })

  it('shares one check between callers that ask at the same time', async () => {
    const initialise = vi.fn<Initialise>(async () => {})
    const { store } = build(initialise)
    await Promise.all([store.refresh(), store.refresh(), store.refresh()])
    expect(initialise.mock.calls.filter(([withImage]) => !withImage)).toHaveLength(1)
  })
})

describe('device store: set up from a click', () => {
  it('downloads with progress and ends ready with image input', async () => {
    const seen: Array<number | null> = []
    const { store } = build(async (_withImage, onProgress) => {
      onProgress?.(0.25)
      onProgress?.(1)
    })
    store.subscribe(() => seen.push(store.getState().progress))

    const state = await store.setUp()
    expect(state).toEqual({ status: 'ready', image: true, progress: null, error: null })
    expect(seen).toContain(0.25)
    expect(seen).toContain(1)
  })

  it('falls back to the text-only model when image input is not available', async () => {
    const initialise = vi.fn<Initialise>(async (withImage) => {
      if (withImage) throw notSupported()
    })
    const { store } = build(initialise)
    const state = await store.setUp()
    expect(state.status).toBe('ready')
    expect(state.image).toBe(false)
    expect(initialise.mock.calls.some(([withImage]) => withImage === false)).toBe(true)
  })

  it('reports the reason when setup fails', async () => {
    const { store } = build(async () => {
      throw new Error('Not enough disk space')
    })
    const state = await store.setUp()
    expect(state.status).toBe('unavailable')
    expect(state.error).toBe('Not enough disk space')
  })

  it('stays "needs a click" if the browser did not accept the click', async () => {
    const { store } = build(async () => {
      throw needsClick()
    })
    expect((await store.setUp()).status).toBe('downloadable')
  })

  it('ignores a second click while setup is running, and status checks do not interrupt it', async () => {
    let finish: () => void = () => {}
    let started = false
    const initialise = vi.fn<Initialise>(() => {
      // Only the first call (the download) waits; later calls answer at once.
      if (started) return Promise.resolve()
      started = true
      return new Promise<void>((resolve) => (finish = resolve))
    })
    const { store } = build(initialise)

    const first = store.setUp()
    await store.setUp()
    expect((await store.refresh(true)).status).toBe('downloading')
    expect(initialise).toHaveBeenCalledTimes(1)

    finish()
    expect((await first).status).toBe('ready')
  })

  it('does nothing when the browser has no on-device model', async () => {
    const initialise = vi.fn<Initialise>(async () => {})
    const { store } = build(initialise, { hasOnDeviceApi: () => false })
    expect((await store.setUp()).status).toBe('unavailable')
    expect(initialise).not.toHaveBeenCalled()
  })
})
