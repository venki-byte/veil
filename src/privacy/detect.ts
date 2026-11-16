/**
 * Detection pipeline: regex first, then Gemini Nano chunk by chunk, then a
 * deterministic merge.
 *
 * The model is passed in as a function so this file stays plain code. The
 * app passes the on-device detector from src/ai/hybrid.ts; unit tests pass a
 * fake. If no detector is given, detection is regex-only.
 */

import { chunkText, DEFAULT_CHUNK_CHARS, type Chunk } from './chunk'
import { detectWithRegex } from './regex'
import { locateAll, mergeSpans } from './spans'
import { isSensitiveType, type SensitiveType, type Span } from './types'

/** What the on-device model returns for one chunk. */
export interface NanoFinding {
  text: string
  type: string
}

export type NanoDetector = (chunkText: string) => Promise<NanoFinding[]>

export interface DetectionResult {
  spans: Span[]
  /** Number of chunks Nano was asked to read. Zero in regex-only mode. */
  nanoChunks: number
  /** Chunks where Nano failed. Their text was covered by regex only. */
  nanoFailures: number
}

export interface DetectOptions {
  nano?: NanoDetector
  maxChunkChars?: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** Field labels and generic words that a small model sometimes returns. */
const GENERIC = new Set(
  [
    'name', 'patient', 'patient name', 'the patient', 'doctor', 'the doctor', 'address', 'date',
    'date of birth', 'dob', 'age', 'sex', 'gender', 'male', 'female', 'phone', 'mobile', 'email',
    'tenant', 'the tenant', 'landlord', 'the landlord', 'lessor', 'lessee', 'licensor', 'licensee',
    'borrower', 'the borrower', 'lender', 'the lender', 'bank', 'the bank', 'hospital',
    'laboratory', 'lab', 'company', 'employer', 'employee', 'customer', 'applicant', 'guarantor',
    'witness', 'signature', 'account', 'account number', 'id', 'reference', 'india', 'rupees',
    'taxpayer', 'assessee', 'department', 'government', 'agreement', 'party', 'parties',
  ],
)

/** A bare number or amount such as "13.5", "₹45,000" or "12%". */
const PLAIN_NUMBER = /^[₹$€£]?\s?(?:rs\.?|inr|usd)?\s?[\d,]+(?:\.\d+)?\s?(?:%|[a-zµ/]{1,8})?$/i

/**
 * Checks one model finding and turns it into spans.
 *
 * Small models make mistakes, so nothing from Nano is trusted blindly:
 *   - the text must really appear in the chunk (no invented values),
 *   - field labels and generic words are dropped,
 *   - short bare numbers (lab values, amounts) are dropped, because the
 *     cloud needs them and long numbers are already handled by regex.
 */
export function spansFromNano(chunk: Chunk, findings: NanoFinding[]): Span[] {
  const spans: Span[] = []
  const seen = new Set<string>()

  for (const finding of findings) {
    if (!finding || typeof finding.text !== 'string') continue
    const text = finding.text.trim().replace(/^["'“‘]+|["'”’.,;:]+$/g, '')
    if (text.length < 2 || text.length > 160) continue
    if (!/[\p{L}\p{N}]/u.test(text)) continue

    const key = text.toLowerCase()
    if (seen.has(key) || GENERIC.has(key)) continue
    seen.add(key)

    const digits = text.replace(/\D/g, '').length
    if (PLAIN_NUMBER.test(text) && digits < 8) continue
    // One or two letters are too ambiguous to replace everywhere.
    if (text.length < 3 && digits === 0) continue

    const rawType = typeof finding.type === 'string' ? finding.type.trim().toUpperCase() : ''
    const type: SensitiveType = isSensitiveType(rawType) && rawType !== 'DATE' ? rawType : 'OTHER'

    for (const hit of locateAll(chunk.text, text)) {
      spans.push({
        start: chunk.start + hit.start,
        end: chunk.start + hit.end,
        text: hit.text,
        type,
        source: 'nano',
      })
    }
  }

  return spans
}

/**
 * Runs the full detection pipeline on a document.
 * Regex always runs. Nano runs on each chunk if a detector is supplied.
 */
export async function detectDocument(text: string, options: DetectOptions = {}): Promise<DetectionResult> {
  const regexSpans = detectWithRegex(text)
  if (!options.nano) {
    return { spans: mergeSpans(regexSpans), nanoChunks: 0, nanoFailures: 0 }
  }

  const chunks = chunkText(text, options.maxChunkChars ?? DEFAULT_CHUNK_CHARS)
  const nanoSpans: Span[] = []
  let failures = 0

  options.onProgress?.(0, chunks.length)
  for (let index = 0; index < chunks.length; index += 1) {
    if (options.signal?.aborted) break
    try {
      const findings = await options.nano(chunks[index].text)
      nanoSpans.push(...spansFromNano(chunks[index], findings))
    } catch {
      // A failed chunk must not stop the document. Regex still covers it,
      // and the failure count is shown to the user.
      failures += 1
    }
    options.onProgress?.(index + 1, chunks.length)
  }

  return {
    spans: mergeSpans([...regexSpans, ...nanoSpans]),
    nanoChunks: chunks.length,
    nanoFailures: failures,
  }
}
