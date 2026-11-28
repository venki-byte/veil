/**
 * Cleans text that the on-device model produced from a photo.
 *
 * A small vision model sometimes emits raw byte tokens such as "<0xE2><0x80>",
 * control characters, or repeats one line many times. None of that is in the
 * photo, and it would be sent on to the cloud as if it were. This is plain
 * code and does not use any model.
 */

/** Raw byte tokens that a model prints when it cannot spell a character. */
const BYTE_TOKEN = /(?:<0x[0-9A-Fa-f]{2}>)+/g

/** Removes control characters except tab and newline. */
function stripControl(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isControl = (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
    if (!isControl) out += char
  }
  return out
}

/** A line may repeat this many times in a row before the rest is treated as a loop. */
const MAX_REPEATS = 2

export function cleanTranscript(raw: string): string {
  const lines = stripControl(raw.replace(/\r\n?/g, '\n').replace(BYTE_TOKEN, ' '))
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, '  ').trimEnd())

  const kept: string[] = []
  let repeats = 0
  for (const line of lines) {
    const previous = kept[kept.length - 1]
    // Short lines (table cells such as "0.00") may legitimately repeat; only longer ones count as a loop.
    if (line.trim().length >= 8 && previous !== undefined && line.trim() === previous.trim()) {
      repeats += 1
      if (repeats >= MAX_REPEATS) continue
    } else {
      repeats = 0
    }
    kept.push(line)
  }

  // A line made only of leftover separators after the clean-up carries nothing.
  return kept
    .filter((line) => line.trim() === '' || /[\p{L}\p{N}]/u.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** How many places the model said it could not read. */
export function countUnreadable(text: string): number {
  return (text.match(/\[unreadable\]/gi) ?? []).length
}
