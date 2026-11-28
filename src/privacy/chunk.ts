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

/** How far back a chunk reaches into the previous one, so a name on the border is seen whole. */
export const DETECTION_OVERLAP_CHARS = 150

/**
 * Splits text into chunks. With `overlapChars` above zero, every chunk after
 * the first also repeats the end of the one before it (starting at a word
 * boundary), so a name or address that falls across a cut appears whole in at
 * least one chunk. Offsets stay correct. The default is no overlap.
 */
export function chunkText(text: string, maxChars: number = DEFAULT_CHUNK_CHARS, overlapChars = 0): Chunk[] {
  if (maxChars < 50) throw new Error('maxChars must be at least 50')

  const chunks: Chunk[] = []
  let offset = 0

  while (offset < text.length) {
    const rest = text.slice(offset)
    const size = rest.length <= maxChars ? rest.length : findCut(rest, maxChars)
    const piece = rest.slice(0, size)
    if (piece.trim().length > 0) {
      let start = offset
      if (overlapChars > 0 && offset > 0) {
        const floor = Math.max(0, offset - overlapChars)
        const gap = text.slice(floor, offset).search(/\s/)
        // Begin just after the first space in the overlap window, never in the middle of a word.
        start = gap >= 0 ? floor + gap + 1 : offset
        if (start > offset) start = offset
      }
      chunks.push({ start, text: text.slice(start, offset + piece.length) })
    }
    offset += size
  }

  return chunks
}
