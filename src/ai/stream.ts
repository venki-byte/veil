/**
 * Joins streamed text pieces. Plain code, unit tested.
 *
 * Streams usually send each new piece of text (a delta). Some versions of
 * the browser's on-device API have sent the whole answer so far each time
 * instead. This handles both: a piece that starts with everything received so
 * far is treated as the full text, anything else is appended.
 */
export function accumulate(soFar: string, piece: string): string {
  if (!piece) return soFar
  if (soFar && piece.length >= soFar.length && piece.startsWith(soFar)) return piece
  return soFar + piece
}
