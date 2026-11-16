/**
 * The leak guard is the last check before anything may leave the device.
 *
 * It is plain code: it looks for every hidden value in the outgoing text and
 * refuses to send if it finds one. It is deliberately stricter than the
 * redaction step, so a value that slipped through in a different shape
 * (different case, different spacing, digits regrouped) is still caught.
 */

import type { Registry } from './registry'
import { valuePattern } from './spans'
import type { SensitiveType } from './types'

export interface Leak {
  placeholder: string
  type: SensitiveType
  /** How the value was recognised in the outgoing text. */
  via: 'exact' | 'digits' | 'name-part'
  /** A short piece of the outgoing text around the leak, for the local UI. */
  excerpt: string
}

export class LeakBlockedError extends Error {
  readonly leaks: Leak[]

  constructor(leaks: Leak[]) {
    const names = [...new Set(leaks.map((leak) => leak.placeholder))].join(', ')
    super(`Blocked before sending: the outgoing text still contains ${names}.`)
    this.name = 'LeakBlockedError'
    this.leaks = leaks
  }
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').toLowerCase()
const compact = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
const digitsIn = (value: string) => value.replace(/\D/g, '').length

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, index + length + 24)
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '')
}

/**
 * Returns every hidden value that still appears in `outbound`.
 * An empty list means the text is safe to send.
 */
export function findLeaks(outbound: string, registry: Registry): Leak[] {
  const leaks: Leak[] = []
  const collapsed = collapse(outbound)
  const compacted = compact(outbound)

  for (const entry of registry.active()) {
    const base = { placeholder: entry.placeholder, type: entry.type }
    const needle = collapse(entry.value)

    // 1. The value itself, ignoring case and spacing. Longer values are
    //    matched anywhere, even glued to other characters.
    let index = -1
    if (needle.length >= 6) {
      index = collapsed.indexOf(needle)
    } else {
      const match = valuePattern(needle).exec(collapsed)
      index = match ? match.index : -1
    }
    if (index >= 0) {
      leaks.push({ ...base, via: 'exact', excerpt: excerptAround(collapsed, index, needle.length) })
      continue
    }

    // 2. Long numbers with their digits regrouped: "9876 543 210",
    //    "9876-543-210" and "9876543210" are the same number.
    if (digitsIn(entry.value) >= 8) {
      const compactNeedle = compact(entry.value)
      const compactIndex = compacted.indexOf(compactNeedle)
      if (compactIndex >= 0) {
        leaks.push({ ...base, via: 'digits', excerpt: `${entry.type} number with different spacing` })
        continue
      }
    }

    // 3. Part of a person's name on its own, e.g. just the surname.
    for (const alias of entry.aliases) {
      const match = valuePattern(alias, true).exec(outbound)
      if (match) {
        leaks.push({ ...base, via: 'name-part', excerpt: excerptAround(outbound, match.index, alias.length) })
        break
      }
    }
  }

  return leaks
}

/** Throws a LeakBlockedError if `outbound` contains any hidden value. */
export function assertNoLeak(outbound: string, registry: Registry): void {
  const leaks = findLeaks(outbound, registry)
  if (leaks.length > 0) throw new LeakBlockedError(leaks)
}
