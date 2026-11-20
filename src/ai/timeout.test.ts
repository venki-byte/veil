import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelTimeoutError, withTimeout } from './timeout'

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('passes through a result that arrives in time', async () => {
    const work = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 1000))
    const result = withTimeout(work, 5000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toBe('done')
  })

  it('passes through an error that arrives in time', async () => {
    const work = Promise.reject(new Error('model crashed'))
    await expect(withTimeout(work, 5000)).rejects.toThrow('model crashed')
  })

  it('stops waiting after the limit, with a clear message', async () => {
    const never = new Promise<string>(() => {})
    const result = withTimeout(never, 45_000)
    const check = expect(result).rejects.toThrow('The model took longer than 45 seconds and was stopped.')
    await vi.advanceTimersByTimeAsync(45_000)
    await check
    await expect(result).rejects.toBeInstanceOf(ModelTimeoutError)
  })

  it('clears its timer when the work finishes', async () => {
    await withTimeout(Promise.resolve(1), 10_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
