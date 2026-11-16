import { describe, expect, it } from 'vitest'
import { assertNoLeak, findLeaks, LeakBlockedError } from './leakGuard'
import { Registry } from './registry'

const build = () => {
  const registry = new Registry()
  registry.add('Asha Verma', 'PERSON', 'nano')
  registry.add('98765 43210', 'CONTACT', 'regex')
  registry.add('50100482913377', 'ACCOUNT', 'regex')
  registry.add('asha.verma@mail.example', 'CONTACT', 'regex')
  return registry
}

describe('leak guard', () => {
  it('passes text that only contains placeholders', () => {
    const registry = build()
    const outbound = registry.redact('Asha Verma (98765 43210) holds account 50100482913377.')
    expect(findLeaks(outbound, registry)).toEqual([])
    expect(() => assertNoLeak(outbound, registry)).not.toThrow()
  })

  it('blocks a planted value', () => {
    const registry = build()
    const outbound = 'Explain this: [PERSON_1] holds account 50100482913377.'
    const leaks = findLeaks(outbound, registry)
    expect(leaks).toHaveLength(1)
    expect(leaks[0].placeholder).toBe('[ACCOUNT_1]')
    expect(() => assertNoLeak(outbound, registry)).toThrow(LeakBlockedError)
  })

  it('names the leaked placeholders in the error, not the values', () => {
    const registry = build()
    try {
      assertNoLeak('Asha Verma called from 98765 43210', registry)
      expect.unreachable('the guard should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(LeakBlockedError)
      const blocked = error as LeakBlockedError
      expect(blocked.leaks.map((leak) => leak.placeholder).sort()).toEqual(['[CONTACT_1]', '[PERSON_1]'])
      expect(blocked.message).toContain('[PERSON_1]')
      expect(blocked.message).not.toContain('Asha')
      expect(blocked.message).not.toContain('98765')
    }
  })

  it('catches a value in a different case or with different spacing', () => {
    const registry = build()
    expect(findLeaks('signed by ASHA VERMA', registry)).toHaveLength(1)
    expect(findLeaks('signed by asha\n   verma', registry)).toHaveLength(1)
    expect(findLeaks('mail ASHA.VERMA@MAIL.EXAMPLE now', registry)).toHaveLength(1)
  })

  it('catches a long number whose digits are grouped differently', () => {
    const registry = build()
    for (const variant of ['9876543210', '9876-543-210', '987 654 3210', '5010 0482 9133 77']) {
      const leaks = findLeaks(`number ${variant} here`, registry)
      expect(leaks, variant).toHaveLength(1)
    }
  })

  it('catches a long value glued to other characters', () => {
    const registry = build()
    expect(findLeaks('idAsha Vermaxyz', registry)).toHaveLength(1)
    expect(findLeaks('ref50100482913377x', registry)).toHaveLength(1)
  })

  it('catches part of a name on its own', () => {
    const registry = new Registry()
    registry.add('Ramesh Kumar Iyer', 'PERSON', 'nano')
    const leaks = findLeaks('Is Mr. Iyer liable?', registry)
    expect(leaks).toHaveLength(1)
    expect(leaks[0].via).toBe('name-part')
  })

  it('does not block short values inside unrelated words', () => {
    const registry = new Registry()
    registry.add('Anand', 'PERSON', 'nano')
    expect(findLeaks('The town of Anandapuram', registry)).toEqual([])
    expect(findLeaks('Ask Anand.', registry)).toHaveLength(1)
  })

  it('ignores values the user chose to leave visible', () => {
    const registry = build()
    const entry = registry.find('Asha Verma')!
    registry.setEnabled(entry.id, false)
    expect(findLeaks('Asha Verma signed', registry)).toEqual([])
  })

  it('does not block amounts that merely share a few digits with an ID', () => {
    const registry = new Registry()
    registry.add('560001', 'ADDRESS', 'nano')
    expect(findLeaks('The fee is Rs. 5,60,001 per year', registry)).toEqual([])
  })

  it('passes when the registry is empty', () => {
    expect(findLeaks('Anything at all', new Registry())).toEqual([])
  })
})
