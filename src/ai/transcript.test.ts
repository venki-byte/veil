import { describe, expect, it } from 'vitest'
import { transcribePrompt } from './prompts'
import { cleanTranscript, countUnreadable } from './transcript'

describe('cleanTranscript', () => {
  it('removes raw byte tokens the model printed', () => {
    const raw = 'Kaveri Electricity Board\n<0xE2><0x80><0xB1> | 2<0xE2><0x80><0xB1>2 | www.example.in'
    const clean = cleanTranscript(raw)
    expect(clean).not.toContain('<0x')
    expect(clean).toContain('Kaveri Electricity Board')
    expect(clean).toContain('www.example.in')
  })

  it('removes control characters and normalises line endings', () => {
    expect(cleanTranscript('a\u0000b\r\nc\u0007d')).toBe('ab\ncd')
  })

  it('stops a loop where the same long line repeats', () => {
    const line = 'Energy charge, slab 2 at the standard rate'
    const clean = cleanTranscript([line, line, line, line, line, 'Total'].join('\n'))
    expect(clean.split('\n').filter((l) => l === line)).toHaveLength(2)
    expect(clean.endsWith('Total')).toBe(true)
  })

  it('keeps short repeated lines such as table cells', () => {
    const clean = cleanTranscript(['0.00', '0.00', '0.00', '0.00'].join('\n'))
    expect(clean.split('\n')).toHaveLength(4)
  })

  it('drops lines left with no letters or digits', () => {
    expect(cleanTranscript('Total\n| |\nRs. 5')).toBe('Total\nRs. 5')
  })

  it('leaves ordinary text and [unreadable] markers alone', () => {
    const text = 'Mobile: [unreadable]\nDue date: 09 Dec 2026'
    expect(cleanTranscript(text)).toBe(text)
  })
})

describe('countUnreadable', () => {
  it('counts markers in any case', () => {
    expect(countUnreadable('a [unreadable] b [Unreadable] c')).toBe(2)
    expect(countUnreadable('nothing here')).toBe(0)
  })
})

describe('transcribePrompt', () => {
  it('forbids inventing text and asks for a marker when unsure', () => {
    const prompt = transcribePrompt()
    expect(prompt).toMatch(/never invent/i)
    expect(prompt).toContain('[unreadable]')
  })

  it('tells the model it sees only part of a page when the page was cut into bands', () => {
    expect(transcribePrompt({ index: 2, total: 3 })).toContain('part 2 of 3')
    expect(transcribePrompt({ index: 1, total: 1 })).not.toContain('part 1 of 1')
    expect(transcribePrompt()).not.toContain('part ')
  })
})
