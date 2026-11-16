import { describe, expect, it } from 'vitest'
import { chunkText, estimateTokens, ON_DEVICE_TOKEN_LIMIT, DEFAULT_CHUNK_CHARS } from './chunk'

describe('chunkText', () => {
  it('returns one chunk for short text', () => {
    const chunks = chunkText('A short letter.')
    expect(chunks).toEqual([{ start: 0, text: 'A short letter.' }])
  })

  it('returns nothing for empty or blank text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
  })

  it('covers the whole text with correct offsets and no overlap', () => {
    const paragraph = 'The tenant shall pay the rent on time. '.repeat(20).trim()
    const text = Array.from({ length: 12 }, (_, i) => `Clause ${i + 1}. ${paragraph}`).join('\n\n')
    const chunks = chunkText(text, 600)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text)
    for (const chunk of chunks) {
      expect(text.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text)
      expect(chunk.text.length).toBeLessThanOrEqual(600)
    }
  })

  it('prefers to cut at paragraph boundaries', () => {
    const a = 'First paragraph. '.repeat(10).trim()
    const b = 'Second paragraph. '.repeat(10).trim()
    const chunks = chunkText(`${a}\n\n${b}`, a.length + 40)
    expect(chunks[0].text.trimEnd()).toBe(a)
    expect(chunks[1].text).toBe(b)
  })

  it('does not cut a word in half when a space is available', () => {
    const text = 'Meenakshi Raghavan lives at Lake View Road Indiranagar Bengaluru '.repeat(10)
    for (const chunk of chunkText(text, 100).slice(0, -1)) {
      expect(chunk.text).toMatch(/\s$/)
    }
  })

  it('hard-cuts text that has no boundaries at all', () => {
    const text = 'x'.repeat(250)
    const chunks = chunkText(text, 100)
    expect(chunks.map((chunk) => chunk.text.length)).toEqual([100, 100, 50])
  })

  it('keeps default chunks far below the on-device token limit', () => {
    const text = 'word '.repeat(5000)
    for (const chunk of chunkText(text)) {
      expect(chunk.text.length).toBeLessThanOrEqual(DEFAULT_CHUNK_CHARS)
      expect(estimateTokens(chunk.text)).toBeLessThan(ON_DEVICE_TOKEN_LIMIT / 4)
    }
  })

  it('rejects an unusably small chunk size', () => {
    expect(() => chunkText('text', 10)).toThrow()
  })
})
