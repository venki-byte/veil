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

  it('can repeat the end of the previous chunk so a name on the border is seen whole', () => {
    const text = 'Meenakshi Raghavan lives at Lake View Road Indiranagar Bengaluru. '.repeat(12)
    const chunks = chunkText(text, 200, 60)
    expect(chunks.length).toBeGreaterThan(2)
    for (let index = 1; index < chunks.length; index += 1) {
      const previousEnd = chunks[index - 1].start + chunks[index - 1].text.length
      // Each chunk begins before the previous one ends, but not by more than the overlap.
      expect(chunks[index].start).toBeLessThan(previousEnd)
      expect(previousEnd - chunks[index].start).toBeLessThanOrEqual(60 + 1)
      // Offsets stay correct, and a chunk never starts in the middle of a word.
      expect(text.slice(chunks[index].start, chunks[index].start + chunks[index].text.length)).toBe(chunks[index].text)
      expect(text[chunks[index].start - 1]).toMatch(/\s/)
    }
    // The text is still fully covered.
    expect(chunks[chunks.length - 1].start + chunks[chunks.length - 1].text.length).toBe(text.length)
  })

  it('finds a name split across a cut when overlap is on', () => {
    const filler = 'word '.repeat(38).trim()
    const text = `${filler}\nRamesh\nSharma ${filler}`
    const plain = chunkText(text, 200)
    const overlapped = chunkText(text, 200, 80)
    expect(plain.some((chunk) => chunk.text.includes('Ramesh\nSharma'))).toBe(false)
    expect(overlapped.some((chunk) => chunk.text.includes('Ramesh\nSharma'))).toBe(true)
  })

  it('has no overlap unless asked', () => {
    const text = 'sentence number one. '.repeat(100)
    const chunks = chunkText(text, 200)
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text)
  })

  it('rejects an unusably small chunk size', () => {
    expect(() => chunkText('text', 10)).toThrow()
  })
})
