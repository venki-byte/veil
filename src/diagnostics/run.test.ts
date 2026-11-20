import { describe, expect, it, vi } from 'vitest'
import { runDiagnostics, ROUTE_MODES, type DiagnosticDeps } from './run'

class Blocked extends Error {}

const goodExplanation = {
  documentType: 'Loan sanction letter',
  summary: 'This letter sanctions a loan of Rs. 5,00,000 over 24 months at 9% a year.',
  keyTerms: [1, 2],
  thingsToWatch: [1],
  deadlinesAndAmounts: [1, 2, 3],
  questionsToAsk: [1, 2],
}

/** Fakes that behave like a healthy machine: Nano ready, online, everything working. */
function healthy(overrides: Partial<DiagnosticDeps> = {}): DiagnosticDeps {
  return {
    routeCheck: async (mode) => ({
      source: mode === 'only_in_cloud' || mode === 'prefer_in_cloud' ? 'in_cloud' : 'on_device',
      durationMs: 500,
      value: 'Hello, the sky is blue.',
    }),
    detect: async () => [{ text: 'Asha Verma', type: 'PERSON' }, { text: '4 Hill Road, Pune', type: 'ADDRESS' }],
    explain: async () => ({ source: 'in_cloud', durationMs: 3000, value: goodExplanation }),
    leakDemo: async () => {
      throw new Blocked('blocked')
    },
    isLeakBlocked: (error) => error instanceof Blocked,
    describeError: (error) => (error instanceof Error ? error.message : 'error'),
    deviceReady: () => true,
    online: () => true,
    now: () => 0,
    ...overrides,
  }
}

const statuses = async (deps: DiagnosticDeps) => (await runDiagnostics(deps)).map((outcome) => outcome.status)

describe('runDiagnostics: a healthy machine', () => {
  it('runs seven checks and all pass', async () => {
    const outcomes = await runDiagnostics(healthy())
    expect(outcomes).toHaveLength(7)
    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(7).fill('pass'))
    expect(outcomes[0].title).toBe('Routing: ONLY_ON_DEVICE')
    expect(outcomes[3].title).toBe('Routing: ONLY_IN_CLOUD')
  })

  it('asks the routing check about each of the four modes, in order', async () => {
    const routeCheck = vi.fn(healthy().routeCheck)
    await runDiagnostics(healthy({ routeCheck }))
    expect(routeCheck.mock.calls.map(([mode]) => mode)).toEqual([...ROUTE_MODES])
  })

  it('reports progress after every check', async () => {
    const seen: Array<[number, number]> = []
    await runDiagnostics(healthy({ onProgress: (done, total) => seen.push([done, total]) }))
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7].map((done) => [done, 7]))
  })

  it('shows what the cloud explanation contained', async () => {
    const outcomes = await runDiagnostics(healthy())
    expect(outcomes[5].detail).toContain('ran IN_CLOUD')
    expect(outcomes[5].detail).toContain('2 key terms')
    expect(outcomes[5].detail).toContain('3 amounts')
    expect(outcomes[5].ms).toBe(3000)
  })
})

describe('runDiagnostics: routing', () => {
  it('fails a mode that ran in the wrong place', async () => {
    const outcomes = await runDiagnostics(
      healthy({ routeCheck: async () => ({ source: 'in_cloud', durationMs: 10, value: 'hi' }) }),
    )
    expect(outcomes[0].status).toBe('fail') // ONLY_ON_DEVICE ran in the cloud
    expect(outcomes[1].status).toBe('fail') // PREFER_ON_DEVICE should have used the ready model
    expect(outcomes[2].status).toBe('pass')
    expect(outcomes[3].status).toBe('pass')
  })

  it('reports an unexpected error as ERROR', async () => {
    const outcomes = await runDiagnostics(
      healthy({
        routeCheck: async (mode) => {
          if (mode === 'only_in_cloud') throw new Error('The cloud refused the request.')
          return { source: 'on_device', durationMs: 1, value: 'x' }
        },
      }),
    )
    expect(outcomes[3]).toMatchObject({ status: 'error', detail: 'The cloud refused the request.' })
  })

  it('treats a refusal as a pass when the machine cannot do that mode', async () => {
    const outcomes = await runDiagnostics(
      healthy({
        deviceReady: () => false,
        routeCheck: async (mode) => {
          if (mode === 'only_on_device') throw new Error('Gemini Nano is not ready')
          return { source: 'in_cloud', durationMs: 1, value: 'x' }
        },
      }),
    )
    expect(outcomes[0]).toMatchObject({ status: 'pass' })
    expect(outcomes[0].detail).toContain('refused as expected')
    expect(outcomes[1].status).toBe('pass') // PREFER_ON_DEVICE correctly fell back to the cloud
  })

  it('expects the right thing when offline', async () => {
    const outcomes = await runDiagnostics(
      healthy({
        online: () => false,
        routeCheck: async (mode) => {
          if (mode === 'only_in_cloud') throw new Error('You are offline')
          return { source: 'on_device', durationMs: 1, value: 'x' }
        },
      }),
    )
    expect(outcomes[2].status).toBe('pass') // PREFER_IN_CLOUD answered from the device
    expect(outcomes[3].status).toBe('pass') // ONLY_IN_CLOUD refused
  })
})

describe('runDiagnostics: structured output and the leak guard', () => {
  it('skips detection with a clear reason when Nano is not ready', async () => {
    const detect = vi.fn(healthy().detect)
    const outcomes = await runDiagnostics(healthy({ deviceReady: () => false, detect }))
    expect(detect).not.toHaveBeenCalled()
    expect(outcomes[4]).toMatchObject({ status: 'fail', detail: 'skipped: Gemini Nano is not ready.' })
  })

  it('fails detection that finds nothing, and lists what it did find otherwise', async () => {
    expect((await runDiagnostics(healthy({ detect: async () => [] })))[4]).toMatchObject({ status: 'fail' })
    const wrong = (await runDiagnostics(healthy({ detect: async () => [{ text: 'Pune', type: 'ADDRESS' }] })))[4]
    expect(wrong.status).toBe('fail')
    expect(wrong.detail).toContain('"Pune" (ADDRESS)')
    expect((await runDiagnostics(healthy()))[4].detail).toContain('"Asha Verma" (PERSON)')
  })

  it('reports a detection error', async () => {
    const outcomes = await runDiagnostics(
      healthy({
        detect: async () => {
          throw new Error('schema rejected')
        },
      }),
    )
    expect(outcomes[4]).toMatchObject({ status: 'error', detail: 'schema rejected' })
  })

  it('fails an explanation with no real summary, or one that did not run in the cloud', async () => {
    const thin = await runDiagnostics(
      healthy({ explain: async () => ({ source: 'in_cloud', durationMs: 1, value: { ...goodExplanation, summary: 'ok' } }) }),
    )
    expect(thin[5].status).toBe('fail')
    const local = await runDiagnostics(
      healthy({ explain: async () => ({ source: 'on_device', durationMs: 1, value: goodExplanation }) }),
    )
    expect(local[5].status).toBe('fail')
  })

  it('skips the cloud explanation when offline', async () => {
    const explain = vi.fn(healthy().explain)
    const outcomes = await runDiagnostics(healthy({ online: () => false, explain }))
    expect(explain).not.toHaveBeenCalled()
    expect(outcomes[5]).toMatchObject({ status: 'fail', detail: 'skipped: offline.' })
  })

  it('reports a cloud error such as a refused App Check token', async () => {
    const outcomes = await runDiagnostics(
      healthy({
        explain: async () => {
          throw new Error('The cloud refused the request. App Check')
        },
      }),
    )
    expect(outcomes[5]).toMatchObject({ status: 'error' })
    expect(outcomes[5].detail).toContain('App Check')
  })

  it('fails if the leak guard lets the planted value through', async () => {
    const outcomes = await runDiagnostics(healthy({ leakDemo: async () => {} }))
    expect(outcomes[6]).toMatchObject({ status: 'fail', detail: 'the planted value was NOT blocked.' })
  })

  it('reports another error from the leak demo as ERROR, not as a block', async () => {
    const outcomes = await runDiagnostics(
      healthy({
        leakDemo: async () => {
          throw new Error('network down')
        },
      }),
    )
    expect(outcomes[6]).toMatchObject({ status: 'error', detail: 'network down' })
  })

  it('keeps going after a failure, so one problem does not hide the rest', async () => {
    expect(
      await statuses(
        healthy({
          routeCheck: async () => {
            throw new Error('everything is broken')
          },
        }),
      ),
    ).toEqual(['error', 'error', 'error', 'error', 'pass', 'pass', 'pass'])
  })
})
