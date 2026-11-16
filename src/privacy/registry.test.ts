import { describe, expect, it } from 'vitest'
import { Registry } from './registry'

describe('Registry: placeholders', () => {
  it('gives each value a typed, numbered placeholder', () => {
    const registry = new Registry()
    expect(registry.add('Asha Verma', 'PERSON', 'nano')?.placeholder).toBe('[PERSON_1]')
    expect(registry.add('Rohan Mathew', 'PERSON', 'nano')?.placeholder).toBe('[PERSON_2]')
    expect(registry.add('ABCPK4821L', 'ID', 'regex')?.placeholder).toBe('[ID_1]')
  })

  it('returns the same placeholder for a repeated value', () => {
    const registry = new Registry()
    const first = registry.add('Asha Verma', 'PERSON', 'nano')
    const again = registry.add('Asha Verma', 'PERSON', 'regex')
    expect(again).toBe(first)
    expect(registry.size).toBe(1)
  })

  it('treats case and spacing differences as the same value', () => {
    const registry = new Registry()
    const first = registry.add('Asha Verma', 'PERSON', 'nano')
    expect(registry.add('ASHA   VERMA', 'PERSON', 'nano')).toBe(first)
    expect(registry.add(' asha\nverma ', 'PERSON', 'nano')).toBe(first)
    expect(registry.add('"Asha Verma",', 'PERSON', 'nano')).toBe(first)
  })

  it('maps part of a known name to the same person', () => {
    const registry = new Registry()
    const person = registry.add('Ramesh Kumar Iyer', 'PERSON', 'nano')
    expect(registry.add('Iyer', 'PERSON', 'nano')).toBe(person)
    expect(registry.size).toBe(1)
  })

  it('treats a name with and without a title as the same person', () => {
    const registry = new Registry()
    const person = registry.add('Meenakshi Raghavan', 'PERSON', 'regex')
    expect(registry.add('Mrs. Meenakshi Raghavan', 'PERSON', 'nano')).toBe(person)
    expect(registry.add('Dr. Anil Deshpande', 'PERSON', 'nano')?.value).toBe('Anil Deshpande')
    expect(registry.redact('Mrs. Meenakshi Raghavan saw Dr. Anil Deshpande')).toBe('Mrs. [PERSON_1] saw Dr. [PERSON_2]')
  })

  it('rejects values that are too short, empty or placeholder-like', () => {
    const registry = new Registry()
    expect(registry.add('A', 'PERSON', 'nano')).toBeNull()
    expect(registry.add('   ', 'PERSON', 'nano')).toBeNull()
    expect(registry.add('---', 'OTHER', 'nano')).toBeNull()
    expect(registry.add('[PERSON_1]', 'PERSON', 'nano')).toBeNull()
    expect(registry.add('x'.repeat(201), 'OTHER', 'nano')).toBeNull()
    expect(registry.size).toBe(0)
  })

  it('leaves plain dates visible by default and hides everything else', () => {
    const registry = new Registry()
    expect(registry.add('10 February 2027', 'DATE', 'regex')?.enabled).toBe(false)
    expect(registry.add('14/08/1973', 'DATE_OF_BIRTH', 'regex')?.enabled).toBe(true)
  })

  it('upgrades a plain date to a hidden birth date', () => {
    const registry = new Registry()
    registry.add('14/08/1973', 'DATE', 'regex')
    const upgraded = registry.add('14/08/1973', 'DATE_OF_BIRTH', 'nano')
    expect(upgraded?.type).toBe('DATE_OF_BIRTH')
    expect(upgraded?.placeholder).toBe('[DATE_OF_BIRTH_1]')
    expect(upgraded?.enabled).toBe(true)
    expect(registry.size).toBe(1)
  })
})

describe('Registry: redact', () => {
  it('replaces every occurrence of a value', () => {
    const registry = new Registry()
    registry.add('Asha Verma', 'PERSON', 'nano')
    const out = registry.redact('Asha Verma signed. Later ASHA VERMA paid. asha  verma left.')
    expect(out).toBe('[PERSON_1] signed. Later [PERSON_1] paid. [PERSON_1] left.')
  })

  it('replaces a value that is split across lines', () => {
    const registry = new Registry()
    registry.add('Meenakshi Raghavan', 'PERSON', 'nano')
    expect(registry.redact('for Meenakshi\nRaghavan only')).toBe('for [PERSON_1] only')
  })

  it('prefers the longer value where two overlap', () => {
    const registry = new Registry()
    registry.add('Pune', 'ADDRESS', 'nano')
    registry.add('Karve Road, Pune 411004', 'ADDRESS', 'regex')
    expect(registry.redact('at Karve Road, Pune 411004. Courts at Pune.')).toBe(
      'at [ADDRESS_2]. Courts at [ADDRESS_1].',
    )
  })

  it('hides name parts under the same placeholder', () => {
    const registry = new Registry()
    registry.add('Ramesh Kumar Iyer', 'PERSON', 'nano')
    expect(registry.redact('Mr. Iyer agreed. Ramesh will pay.')).toBe(
      'Mr. [PERSON_1] agreed. [PERSON_1] will pay.',
    )
  })

  it('does not treat an everyday word as a name part', () => {
    const registry = new Registry()
    registry.add('Rose Bill', 'PERSON', 'nano')
    const text = 'The bill is due. Bill Date: today. A rose garden.'
    expect(registry.redact(text)).toBe(text)
  })

  it('does not replace inside a longer word', () => {
    const registry = new Registry()
    registry.add('Anand', 'PERSON', 'nano')
    expect(registry.redact('Anand lives in Anandapuram')).toBe('[PERSON_1] lives in Anandapuram')
  })

  it('leaves a value visible once the user disables it', () => {
    const registry = new Registry()
    const org = registry.add('Coastal Bank', 'ORG', 'nano')!
    registry.add('Asha Verma', 'PERSON', 'nano')
    registry.setEnabled(org.id, false)
    expect(registry.redact('Asha Verma banks with Coastal Bank')).toBe('[PERSON_1] banks with Coastal Bank')
    registry.setEnabled(org.id, true)
    expect(registry.redact('Asha Verma banks with Coastal Bank')).toBe('[PERSON_1] banks with [ORG_1]')
  })

  it('returns segments that rebuild the original text exactly', () => {
    const registry = new Registry()
    registry.add('Asha Verma', 'PERSON', 'nano')
    registry.add('98765 43210', 'CONTACT', 'regex')
    const text = 'Call Asha Verma on 98765 43210 after 5 pm.'
    const segments = registry.segments(text)
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
    expect(segments.filter((segment) => segment.entry).map((segment) => segment.text)).toEqual([
      'Asha Verma',
      '98765 43210',
    ])
  })
})

describe('Registry: rehydrate', () => {
  const build = () => {
    const registry = new Registry()
    registry.add('Asha Verma', 'PERSON', 'nano')
    registry.add('Coastal Bank', 'ORG', 'nano')
    registry.add('50100482913377', 'ACCOUNT', 'regex')
    return registry
  }

  it('round-trips: rehydrate(redact(text)) restores the text', () => {
    const registry = build()
    const text = 'Asha Verma holds account 50100482913377 at Coastal Bank. Asha Verma signed.'
    const redacted = registry.redact(text)
    expect(redacted).not.toContain('Asha')
    expect(redacted).not.toContain('50100482913377')
    expect(registry.rehydrate(redacted)).toBe(text)
  })

  it('restores placeholders inside a model answer', () => {
    const registry = build()
    const answer = '[PERSON_1] must keep enough money in [ACCOUNT_1] at [ORG_1].'
    expect(registry.rehydrate(answer)).toBe(
      'Asha Verma must keep enough money in 50100482913377 at Coastal Bank.',
    )
  })

  it('tolerates changed case, inner spaces and missing brackets', () => {
    const registry = build()
    expect(registry.rehydrate('[person_1] and [ PERSON_1 ] and PERSON_1.')).toBe(
      'Asha Verma and Asha Verma and Asha Verma.',
    )
  })

  it('leaves unknown placeholders untouched', () => {
    const registry = build()
    expect(registry.rehydrate('[PERSON_9] wrote to [PERSON_1]')).toBe('[PERSON_9] wrote to Asha Verma')
  })

  it('does not confuse PERSON_1 with PERSON_10', () => {
    const registry = new Registry()
    for (let i = 1; i <= 10; i += 1) registry.add(`Person Number${String.fromCharCode(64 + i)}`, 'PERSON', 'nano')
    expect(registry.rehydrate('[PERSON_10] and [PERSON_1]')).toBe('Person NumberJ and Person NumberA')
  })

  it('still restores a placeholder after its entry is disabled', () => {
    const registry = build()
    const entry = registry.byPlaceholder('[ORG_1]')!
    registry.setEnabled(entry.id, false)
    expect(registry.rehydrate('Write to [ORG_1]')).toBe('Write to Coastal Bank')
  })

  it('marks restored values in segments', () => {
    const registry = build()
    const segments = registry.rehydrateSegments('Ask [PERSON_1] today')
    expect(segments).toHaveLength(3)
    expect(segments[1].text).toBe('Asha Verma')
    expect(segments[1].entry?.placeholder).toBe('[PERSON_1]')
  })
})
