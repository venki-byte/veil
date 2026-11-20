/**
 * Builds the plain-text diagnostic report that the Routing page can copy.
 *
 * Plain code, unit tested. The report is meant to be pasted into a chat or an
 * issue, so it removes anything that looks like a key or token, and it never
 * includes document text: the ledger section lists how many characters were
 * sent to the cloud, not what they were.
 */

import type { LedgerEntry } from '../ledger/store'

export type CheckStatus = 'pass' | 'fail' | 'error'

export interface CheckOutcome {
  title: string
  /** What a healthy result looks like, in a few words. */
  expected: string
  status: CheckStatus
  /** What actually happened. */
  detail: string
  ms?: number
}

export interface ConsoleEntry {
  time: number
  level: 'error' | 'warn'
  text: string
}

export interface ReportInput {
  generatedAt: Date
  page: string
  userAgent: string
  online: boolean
  firebaseConfigured: boolean
  appCheck: string
  /** Whether a debug token is set in .env. The token itself is never reported. */
  debugTokenInEnv: boolean
  device: { status: string; image: boolean; error: string | null }
  cloudModel: string
  checks: CheckOutcome[]
  ledger: LedgerEntry[]
  consoleEntries: ConsoleEntry[]
  /** Extra text to print at the end, such as a results table. */
  appendix?: string
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const API_KEY = /AIza[\w-]{30,}/g
const BEARER = /\b(?:Bearer|Firebase)\s+[\w.~+/=-]{20,}/g

/** Removes API keys, debug tokens and auth headers from text. */
export function scrub(text: string): string {
  return text
    .replace(API_KEY, '[key removed]')
    .replace(UUID, '[token removed]')
    .replace(BEARER, '[credential removed]')
}

const oneLine = (text: string, limit: number) => {
  const flat = scrub(text).replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export type SourceName = 'on_device' | 'in_cloud'

/**
 * Where a call in each inference mode should run, given the state of the
 * machine. Used to judge the routing check.
 */
export function expectedSource(mode: string, deviceReady: boolean, online: boolean): SourceName | 'error' {
  switch (mode) {
    case 'only_on_device':
      return deviceReady ? 'on_device' : 'error'
    case 'prefer_on_device':
      return deviceReady ? 'on_device' : 'in_cloud'
    case 'prefer_in_cloud':
      return online ? 'in_cloud' : deviceReady ? 'on_device' : 'error'
    case 'only_in_cloud':
      return online ? 'in_cloud' : 'error'
    default:
      return 'error'
  }
}

const label = (value: boolean) => (value ? 'yes' : 'no')

const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

const STATUS_MARK: Record<CheckStatus, string> = { pass: 'PASS', fail: 'FAIL', error: 'ERROR' }

function ledgerLine(entry: LedgerEntry): string {
  const time = new Date(entry.time).toISOString().slice(11, 19)
  const ran = entry.source ? `${entry.source.toUpperCase()}${entry.model ? ` (${entry.model})` : ''}` : 'DID NOT RUN'
  const sent = entry.outbound === null ? 'nothing sent' : `${entry.outbound.length} chars sent to cloud`
  const parts = [`${time}`, entry.task, entry.mode, ran, formatMs(entry.durationMs), entry.status.toUpperCase(), sent]
  const extra = [entry.note, entry.error].filter(Boolean).map((text) => oneLine(String(text), 220))
  return `- ${parts.join(' | ')}${extra.length ? `\n    ${extra.join('\n    ')}` : ''}`
}

export function buildReport(input: ReportInput): string {
  const passed = input.checks.filter((check) => check.status === 'pass').length
  const problems = input.checks.filter((check) => check.status !== 'pass')

  const lines: string[] = [
    'VEIL DIAGNOSTIC REPORT',
    `Generated: ${input.generatedAt.toISOString()}`,
    `Page: ${scrub(input.page)}`,
    `Browser: ${oneLine(input.userAgent, 200)}`,
    '',
    'SETUP',
    `- Online: ${label(input.online)}`,
    `- Firebase configured: ${label(input.firebaseConfigured)}`,
    `- App Check: ${input.appCheck}; debug token set in .env: ${label(input.debugTokenInEnv)}`,
    `- Gemini Nano: ${input.device.status}; image input: ${label(input.device.image)}${
      input.device.error ? `; setup error: ${oneLine(input.device.error, 300)}` : ''
    }`,
    `- Cloud model: ${input.cloudModel}`,
    '',
    `SUMMARY: ${passed} of ${input.checks.length} checks passed.${
      problems.length ? ` Not passing: ${problems.map((check) => check.title).join('; ')}.` : ''
    }`,
    '',
    'CHECKS',
  ]

  input.checks.forEach((check, index) => {
    lines.push(
      `${index + 1}. [${STATUS_MARK[check.status]}] ${check.title}${check.ms !== undefined ? ` (${formatMs(check.ms)})` : ''}`,
      `   Expected: ${check.expected}`,
      `   Result: ${oneLine(check.detail, 500)}`,
    )
  })

  lines.push('', `LEDGER (${input.ledger.length} calls this session; text sent to the cloud is counted, not shown)`)
  lines.push(...(input.ledger.length ? input.ledger.map(ledgerLine) : ['- none']))

  const recent = input.consoleEntries.slice(-20)
  lines.push('', `RECENT CONSOLE ERRORS AND WARNINGS (${recent.length})`)
  lines.push(
    ...(recent.length
      ? recent.map((entry) => `- ${new Date(entry.time).toISOString().slice(11, 19)} ${entry.level}: ${oneLine(entry.text, 400)}`)
      : ['- none']),
  )

  if (input.appendix) lines.push('', 'APPENDIX', input.appendix)

  return lines.join('\n')
}
