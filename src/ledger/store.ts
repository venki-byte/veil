/**
 * The privacy ledger: a running list of every model call made in this session.
 *
 * Each entry records which task ran, which inference mode was requested,
 * where the call actually ran, and the exact text that left the device (if
 * any). It lives in memory only and is cleared when the page is closed.
 */

import { useSyncExternalStore } from 'react'

export type InferenceSourceName = 'on_device' | 'in_cloud'

export type LedgerStatus = 'ok' | 'error' | 'blocked'

export interface LedgerEntry {
  id: number
  time: number
  /** Human-readable task name, e.g. "Detect personal details". */
  task: string
  /** Requested inference mode, e.g. "only_on_device". */
  mode: string
  /** Where the call actually ran. Null if it never ran. */
  source: InferenceSourceName | null
  durationMs: number
  status: LedgerStatus
  /** The exact text sent to the cloud. Null when nothing left the device. */
  outbound: string | null
  /** Size of what the model was given, in characters. */
  inputChars: number
  /** Whether the input included an image (processed on-device only). */
  hadImage: boolean
  /** The cloud model that answered, when the call ran in the cloud. */
  model?: string
  /** Extra context, such as a fallback or the list of blocked placeholders. */
  note?: string
  error?: string
}

let entries: LedgerEntry[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'time'>): LedgerEntry {
  const full: LedgerEntry = { ...entry, id: nextId, time: Date.now() }
  nextId += 1
  entries = [...entries, full]
  emit()
  return full
}

export function clearLedger(): void {
  entries = []
  emit()
}

export function getLedger(): LedgerEntry[] {
  return entries
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook: the current ledger entries, oldest first. */
export function useLedger(): LedgerEntry[] {
  return useSyncExternalStore(subscribe, getLedger)
}

export interface LedgerTotals {
  calls: number
  onDevice: number
  inCloud: number
  blocked: number
  failed: number
  /** Total characters sent to the cloud. */
  charsSent: number
}

export function summariseLedger(list: LedgerEntry[]): LedgerTotals {
  return {
    calls: list.length,
    onDevice: list.filter((entry) => entry.source === 'on_device').length,
    inCloud: list.filter((entry) => entry.source === 'in_cloud').length,
    blocked: list.filter((entry) => entry.status === 'blocked').length,
    failed: list.filter((entry) => entry.status === 'error').length,
    charsSent: list.reduce((sum, entry) => sum + (entry.outbound?.length ?? 0), 0),
  }
}
