import { beforeEach, describe, expect, it } from 'vitest'
import type { LedgerEntry } from '../ledger/store'
import { clearConsoleEntries, getConsoleEntries, recordConsoleEntry } from './consoleLog'
import { buildReport, expectedSource, scrub, type ReportInput } from './report'

const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 1,
  time: Date.UTC(2026, 10, 20, 9, 30, 15),
  task: 'Detect personal details',
  mode: 'only_on_device',
  source: 'on_device',
  durationMs: 1250,
  status: 'ok',
  outbound: null,
  inputChars: 900,
  hadImage: false,
  ...overrides,
})

const base = (overrides: Partial<ReportInput> = {}): ReportInput => ({
  generatedAt: new Date('2026-11-20T09:31:00.000Z'),
  page: 'http://localhost:5173/#/routing',
  userAgent: 'Mozilla/5.0 Chrome/142.0',
  online: true,
  firebaseConfigured: true,
  appCheck: 'debug',
  debugTokenInEnv: true,
  device: { status: 'ready', image: true, error: null },
  cloudModel: 'gemini-3.5-flash-lite',
  checks: [
    { title: 'ONLY_ON_DEVICE', expected: 'ON_DEVICE', status: 'pass', detail: 'ran ON_DEVICE', ms: 800 },
    { title: 'ONLY_IN_CLOUD', expected: 'IN_CLOUD', status: 'error', detail: 'The cloud refused the request.', ms: 120 },
  ],
  ledger: [entry()],
  consoleEntries: [],
  ...overrides,
})

describe('scrub', () => {
  it('removes API keys, debug tokens and credentials', () => {
    const text =
      'key AIzaSyA0000000000fakefakefakefake000000 token 11111111-2222-4333-8444-555555555555 header Bearer abcdefghijklmnopqrstuvwxyz0123'
    const clean = scrub(text)
    expect(clean).not.toContain('AIza')
    expect(clean).not.toContain('11111111-2222')
    expect(clean).not.toContain('abcdefghijklmnop')
    expect(clean).toContain('[key removed]')
    expect(clean).toContain('[token removed]')
    expect(clean).toContain('[credential removed]')
  })

  it('leaves ordinary text alone', () => {
    expect(scrub('Error fetching from the model: 403 Forbidden')).toBe('Error fetching from the model: 403 Forbidden')
  })
})

describe('expectedSource', () => {
  it('ONLY_ON_DEVICE needs the model', () => {
    expect(expectedSource('only_on_device', true, true)).toBe('on_device')
    expect(expectedSource('only_on_device', false, true)).toBe('error')
  })

  it('PREFER_ON_DEVICE falls back to the cloud', () => {
    expect(expectedSource('prefer_on_device', true, true)).toBe('on_device')
    expect(expectedSource('prefer_on_device', false, true)).toBe('in_cloud')
  })

  it('PREFER_IN_CLOUD falls back to the device when offline', () => {
    expect(expectedSource('prefer_in_cloud', true, true)).toBe('in_cloud')
    expect(expectedSource('prefer_in_cloud', true, false)).toBe('on_device')
    expect(expectedSource('prefer_in_cloud', false, false)).toBe('error')
  })

  it('ONLY_IN_CLOUD needs a connection', () => {
    expect(expectedSource('only_in_cloud', true, true)).toBe('in_cloud')
    expect(expectedSource('only_in_cloud', true, false)).toBe('error')
  })

  it('treats an unknown mode as an error', () => {
    expect(expectedSource('whatever', true, true)).toBe('error')
  })
})

describe('buildReport', () => {
  it('summarises the setup and the checks', () => {
    const report = buildReport(base())
    expect(report).toContain('VEIL DIAGNOSTIC REPORT')
    expect(report).toContain('Generated: 2026-11-20T09:31:00.000Z')
    expect(report).toContain('- Gemini Nano: ready; image input: yes')
    expect(report).toContain('- App Check: debug; debug token set in .env: yes')
    expect(report).toContain('- Cloud model: gemini-3.5-flash-lite')
    expect(report).toContain('SUMMARY: 1 of 2 checks passed. Not passing: ONLY_IN_CLOUD.')
    expect(report).toContain('1. [PASS] ONLY_ON_DEVICE (800 ms)')
    expect(report).toContain('2. [ERROR] ONLY_IN_CLOUD (120 ms)')
    expect(report).toContain('Result: The cloud refused the request.')
  })

  it('says so when everything passes', () => {
    const report = buildReport(base({ checks: [base().checks[0]] }))
    expect(report).toContain('SUMMARY: 1 of 1 checks passed.')
    expect(report).not.toContain('Not passing')
  })

  it('lists ledger calls with sizes, never the text that was sent', () => {
    const secret = 'Explain this document about Asha Verma'
    const report = buildReport(
      base({
        ledger: [
          entry(),
          entry({ id: 2, task: 'Explain document', mode: 'only_in_cloud', source: 'in_cloud', durationMs: 4200, outbound: secret }),
          entry({ id: 3, task: 'Explain document', source: null, status: 'blocked', note: 'Leak guard blocked this call.' }),
        ],
      }),
    )
    expect(report).toContain('LEDGER (3 calls')
    expect(report).toContain('09:30:15 | Detect personal details | only_on_device | ON_DEVICE | 1.3 s | OK | nothing sent')
    expect(report).toContain(`${secret.length} chars sent to cloud`)
    expect(report).not.toContain(secret)
    expect(report).toContain('BLOCKED')
    expect(report).toContain('Leak guard blocked this call.')
  })

  it('never contains keys or tokens, even if they appear in errors', () => {
    const report = buildReport(
      base({
        page: 'http://localhost:5173/?key=AIzaSyA0000000000fakefakefakefake000000',
        device: { status: 'unavailable', image: false, error: 'failed 11111111-2222-4333-8444-555555555555' },
        checks: [{ title: 'x', expected: 'y', status: 'error', detail: 'token 11111111-2222-4333-8444-555555555555', ms: 1 }],
      }),
    )
    expect(report).not.toContain('AIzaSy')
    expect(report).not.toContain('11111111-2222')
  })

  it('includes only the 20 most recent console entries', () => {
    const consoleEntries = Array.from({ length: 30 }, (_, index) => ({
      time: Date.UTC(2026, 10, 20, 9, 31, 0),
      level: 'error' as const,
      text: `problem number ${index}`,
    }))
    const report = buildReport(base({ consoleEntries }))
    expect(report).toContain('RECENT CONSOLE ERRORS AND WARNINGS (20)')
    expect(report).toContain('problem number 29')
    expect(report).toContain('problem number 10')
    expect(report).not.toContain('problem number 9\n')
    expect(report).not.toContain('problem number 0')
  })

  it('says "none" for empty sections and shortens very long text', () => {
    const report = buildReport(base({ ledger: [], checks: [{ title: 't', expected: 'e', status: 'fail', detail: 'x'.repeat(2000), ms: 5 }] }))
    expect(report).toContain('LEDGER (0 calls')
    expect(report).toMatch(/LEDGER[^\n]*\n- none/)
    expect(report).toMatch(/\(0\)\n- none/)
    expect(report).toContain('x'.repeat(500) + '…')
    expect(report).not.toContain('x'.repeat(501))
  })
})

describe('console capture', () => {
  beforeEach(() => clearConsoleEntries())

  it('records scrubbed, shortened entries', () => {
    recordConsoleEntry('error', ['Request failed', new Error('403 for AIzaSyA0000000000fakefakefakefake000000'), { code: 7 }])
    const [recorded] = getConsoleEntries()
    expect(recorded.level).toBe('error')
    expect(recorded.text).toContain('Request failed')
    expect(recorded.text).toContain('Error: 403 for [key removed]')
    expect(recorded.text).toContain('{"code":7}')
    expect(recorded.text).not.toContain('AIza')
  })

  it('keeps only the most recent 40 entries', () => {
    for (let index = 0; index < 55; index += 1) recordConsoleEntry('warn', [`warning ${index}`])
    const all = getConsoleEntries()
    expect(all).toHaveLength(40)
    expect(all[0].text).toBe('warning 15')
    expect(all.at(-1)?.text).toBe('warning 54')
  })

  it('truncates very long messages', () => {
    recordConsoleEntry('error', ['y'.repeat(5000)])
    expect(getConsoleEntries()[0].text.length).toBe(600)
  })
})
