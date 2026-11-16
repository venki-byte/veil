/**
 * Splits a document into short chunks for on-device detection.
 *
 * Gemini Nano accepts at most 9,216 input tokens, and small models are far
 * more reliable on short, narrow inputs. We therefore keep chunks well under
 * the limit (about 600 tokens by default) and split on natural boundaries so
 * a name or address is not cut in half.
 */

export const ON_DEVICE_TOKEN_LIMIT = 9216

/** Default chunk size in characters. Roughly 500 to 700 tokens. */
export const DEFAULT_CHUNK_CHARS = 1800

export interface Chunk {
  /** Offset of this chunk in the original text. */
  start: number
  text: string
}

/**
 * Conservative token estimate. English averages about 4 characters per
 * token; digits, punctuation and non-Latin scripts use more tokens, so we
 * assume 3 characters per token to stay on the safe side.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

/** Finds the best place to cut `text` at or before `limit`. */
function findCut(text: string, limit: number): number {
  const window = text.slice(0, limit)
  const minimum = Math.floor(limit * 0.4)

  const boundaries: RegExp[] = [
    /\n\s*\n/g, // paragraph
    /\n/g, // line
    /[.!?।]\s/g, // sentence
    /\s/g, // word
  ]

  for (const boundary of boundaries) {
    let cut = -1
    for (const match of window.matchAll(boundary)) {
      const end = match.index + match[0].length
      if (end >= minimum) cut = end
    }
    if (cut > 0) return cut
  }
  return limit // no boundary found: hard cut
}

export function chunkText(text: string, maxChars: number = DEFAULT_CHUNK_CHARS): Chunk[] {
  if (maxChars < 50) throw new Error('maxChars must be at least 50')

  const chunks: Chunk[] = []
  let offset = 0

  while (offset < text.length) {
    const rest = text.slice(offset)
    const size = rest.length <= maxChars ? rest.length : findCut(rest, maxChars)
    const piece = rest.slice(0, size)
    if (piece.trim().length > 0) {
      chunks.push({ start: offset, text: piece })
    }
    offset += size
  }

  return chunks
}
