/**
 * Keeps the last few console errors and warnings in memory, so the
 * diagnostic report can include them. Nothing is stored or sent anywhere;
 * the list is gone when the tab closes.
 */

import { scrub, type ConsoleEntry } from './report'

const MAX_ENTRIES = 40
const MAX_CHARS = 600

let entries: ConsoleEntry[] = []
let installed = false

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export function recordConsoleEntry(level: ConsoleEntry['level'], parts: unknown[]): void {
  const text = scrub(parts.map(describe).join(' ')).slice(0, MAX_CHARS)
  entries = [...entries, { time: Date.now(), level, text }].slice(-MAX_ENTRIES)
}

export function getConsoleEntries(): ConsoleEntry[] {
  return entries
}

export function clearConsoleEntries(): void {
  entries = []
}

/** Wraps console.error and console.warn once, and listens for uncaught errors. */
export function installConsoleCapture(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...parts: unknown[]) => {
      recordConsoleEntry(level, parts)
      original(...parts)
    }
  }

  window.addEventListener('error', (event) => recordConsoleEntry('error', [event.message || 'Uncaught error']))
  window.addEventListener('unhandledrejection', (event) => recordConsoleEntry('error', ['Unhandled rejection:', event.reason]))
}
