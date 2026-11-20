import { describe, expect, it, vi } from 'vitest'
import { detectDocument, spansFromNano, type NanoDetector, type NanoFinding } from './detect'
import { findLeaks } from './leakGuard'
import { Registry } from './registry'
import labReport from '../../samples/lab-report.txt?raw'
import rental from '../../samples/rental-agreement.txt?raw'
import loan from '../../samples/loan-sanction-letter.txt?raw'

/**
 * A stand-in for Gemini Nano, used in unit tests only. It "finds" whichever
 * of the given values appear in the chunk it is shown.
 */
const fakeNano =
  (known: NanoFinding[]): NanoDetector =>
  async (chunk) => {
    const flat = chunk.replace(/\s+/g, ' ').toLowerCase()
    return known.filter((finding) => flat.includes(finding.text.toLowerCase()))
  }

describe('spansFromNano', () => {
  const chunk = { start: 100, text: 'Mrs. Raghavan saw Dr. Deshpande. Haemoglobin 10.8. Patient: Raghavan' }

  it('locates each finding and offsets it by the chunk position', () => {
    const spans = spansFromNano(chunk, [{ text: 'Deshpande', type: 'PERSON' }])
    expect(spans).toEqual([{ start: 122, end: 131, text: 'Deshpande', type: 'PERSON', source: 'nano' }])
  })

  it('returns every occurrence of a finding', () => {
    expect(spansFromNano(chunk, [{ text: 'Raghavan', type: 'PERSON' }])).toHaveLength(2)
  })

  it('drops values the model invented', () => {
    expect(spansFromNano(chunk, [{ text: 'Sunita Bhosale', type: 'PERSON' }])).toEqual([])
  })

  it('drops field labels and generic words', () => {
    expect(spansFromNano(chunk, [{ text: 'Patient', type: 'PERSON' }])).toEqual([])
  })

  it('drops lab values and amounts so the cloud can still explain them', () => {
    expect(spansFromNano(chunk, [{ text: '10.8', type: 'OTHER' }])).toEqual([])
    const money = { start: 0, text: 'Fee Rs. 32,000 and 8%' }
    expect(spansFromNano(money, [{ text: '32,000', type: 'OTHER' }, { text: '8%', type: 'OTHER' }])).toEqual([])
  })

  it('keeps a date-of-birth label only when the text says it is a birth date', () => {
    const lab = { start: 0, text: 'Date of Birth: 14/08/1973\nSample Collected: 09/11/2026 07:40' }
    const spans = spansFromNano(lab, [
      { text: '14/08/1973', type: 'DATE_OF_BIRTH' },
      { text: '09/11/2026', type: 'DATE_OF_BIRTH' },
    ])
    expect(spans.map((span) => [span.text, span.type])).toEqual([
      ['14/08/1973', 'DATE_OF_BIRTH'],
      ['09/11/2026', 'DATE'],
    ])
  })

  it('does not carry a birth cue from one line to the next', () => {
    const text = { start: 0, text: 'DOB\n09/11/2026 is the report date' }
    expect(spansFromNano(text, [{ text: '09/11/2026', type: 'DATE_OF_BIRTH' }])[0].type).toBe('DATE')
  })

  it('falls back to OTHER for an unknown type', () => {
    const spans = spansFromNano(chunk, [{ text: 'Deshpande', type: 'DOCTOR' }])
    expect(spans[0].type).toBe('OTHER')
  })

  it('survives malformed findings', () => {
    const bad = [null, {}, { text: 42 }, { text: '' }, { text: 'Deshpande' }] as unknown as NanoFinding[]
    const spans = spansFromNano(chunk, bad)
    expect(spans).toHaveLength(1)
    expect(spans[0].type).toBe('OTHER')
  })
})

describe('detectDocument', () => {
  it('runs regex only when no on-device model is supplied', async () => {
    const result = await detectDocument('Email asha@mail.example, signed Asha Verma')
    expect(result.nanoChunks).toBe(0)
    expect(result.spans.map((span) => span.text)).toEqual(['asha@mail.example'])
  })

  it('merges regex and Nano findings without overlaps', async () => {
    const text = 'Asha Verma (asha@mail.example) lives at 4 Hill Road. Phone 98765 43210.'
    const nano = fakeNano([
      { text: 'Asha Verma', type: 'PERSON' },
      { text: '4 Hill Road', type: 'ADDRESS' },
      { text: 'asha@mail.example', type: 'OTHER' }, // also found by regex
      { text: '43210', type: 'OTHER' }, // inside the phone number found by regex
    ])
    const { spans } = await detectDocument(text, { nano })

    expect(spans.map((span) => [span.text, span.type, span.source])).toEqual([
      ['Asha Verma', 'PERSON', 'nano'],
      ['asha@mail.example', 'CONTACT', 'regex'],
      ['4 Hill Road', 'ADDRESS', 'nano'],
      ['98765 43210', 'CONTACT', 'regex'],
    ])
  })

  it('reads the document chunk by chunk and reports progress', async () => {
    const text = Array.from({ length: 8 }, (_, i) => `Paragraph ${i}. ` + 'Plain words here. '.repeat(12)).join('\n\n')
    const nano = vi.fn<NanoDetector>(async () => [])
    const progress: Array<[number, number]> = []
    const result = await detectDocument(text, {
      nano,
      maxChunkChars: 400,
      onProgress: (done, total) => progress.push([done, total]),
    })

    expect(result.nanoChunks).toBeGreaterThan(3)
    expect(nano).toHaveBeenCalledTimes(result.nanoChunks)
    for (const [chunk] of nano.mock.calls) expect(chunk.length).toBeLessThanOrEqual(400)
    expect(progress[0]).toEqual([0, result.nanoChunks])
    expect(progress.at(-1)).toEqual([result.nanoChunks, result.nanoChunks])
  })

  it('keeps going when Nano fails on a chunk, and counts the failure', async () => {
    const text = 'Asha Verma writes.\n\n' + 'Filler sentence here. '.repeat(30) + '\n\nReach her at asha@mail.example'
    let call = 0
    const nano: NanoDetector = async (chunk) => {
      call += 1
      if (call === 1) throw new Error('model crashed')
      return fakeNano([{ text: 'Asha Verma', type: 'PERSON' }])(chunk)
    }
    const result = await detectDocument(text, { nano, maxChunkChars: 300 })
    expect(result.nanoFailures).toBe(1)
    expect(result.spans.map((span) => span.text)).toContain('asha@mail.example')
  })
})

describe('end to end on the sample documents (fake Nano)', () => {
  const cases = [
    {
      name: 'lab report',
      text: labReport,
      nano: [
        { text: 'Meenakshi Raghavan', type: 'PERSON' },
        { text: 'Anil Deshpande', type: 'PERSON' },
        { text: 'Kavitha Subramaniam', type: 'PERSON' },
        { text: 'SUNRISE DIAGNOSTICS & PATHOLOGY LAB', type: 'ORG' },
        { text: '14, Lake View Road, Indiranagar, Bengaluru 560038', type: 'ADDRESS' },
      ],
      mustHide: [
        'Meenakshi', 'Raghavan', 'Deshpande', 'Subramaniam', 'Lake View Road', '98450', '14/08/1973',
        'SDL-20261187', 'mailbox.example', '4123 5567', 'KMC-48213',
      ],
      mustKeep: ['10.8', 'HbA1c', '7.1', 'microcytic anaemia', '132'],
    },
    {
      name: 'rental agreement',
      text: rental,
      nano: [
        { text: 'Prakash Kulkarni', type: 'PERSON' },
        { text: 'Vasant Kulkarni', type: 'PERSON' },
        { text: 'Farah Siddiqui', type: 'PERSON' },
        { text: 'Imran Siddiqui', type: 'PERSON' },
        { text: 'Sunita Bhosale', type: 'PERSON' },
        { text: 'Rohan Mathew', type: 'PERSON' },
        { text: 'Flat 7A, Silver Oak Residency, Baner Road, Pune 411045', type: 'ADDRESS' },
      ],
      mustHide: [
        'Kulkarni', 'Siddiqui', 'Bhosale', 'Mathew', 'ABCPK4821L', 'BQTPS7719M', '4821 7730 9165',
        '97654 32180', 'inbox.example', '50100482913377', 'HDFC0001742', 'Shantiniketan', 'Banjara Hills',
        'Silver Oak',
      ],
      mustKeep: ['Rs. 32,000', 'Rs. 1,50,000', '11 months', '8%', '2 months'],
    },
    {
      name: 'loan sanction letter',
      text: loan,
      nano: [
        { text: 'Karthik Venugopal', type: 'PERSON' },
        { text: 'Divya Karthik', type: 'PERSON' },
        { text: 'Lakshmi Narayanan', type: 'PERSON' },
        { text: 'NORTHFIELD HOUSING FINANCE LIMITED', type: 'ORG' },
        { text: 'Coastal Bank', type: 'ORG' },
        { text: 'Flat B-904, Palm Grove Heights, Sholinganallur, Chennai 600119', type: 'ADDRESS' },
      ],
      mustHide: [
        'Karthik', 'Venugopal', 'Divya', 'Narayanan', 'Velachery', '90031 55742', 'postbox.example',
        'AFKPV3391Q', 'CUST00771845', '007701529934', 'CSTB0000457', 'Palm Grove', 'Coastal Bank',
        'Northfield', 'APP-2026-338104',
      ],
      mustKeep: ['Rs. 62,00,000', '8.85%', '240 months', 'Rs. 55,180', '10 February 2027', '90 days'],
    },
  ]

  it.each(cases)('redacts the $name, keeps what the cloud needs, and passes the leak guard', async (sample) => {
    const { spans } = await detectDocument(sample.text, { nano: fakeNano(sample.nano) })
    const registry = new Registry()
    registry.addSpans(spans)

    const redacted = registry.redact(sample.text)
    for (const secret of sample.mustHide) expect(redacted.toLowerCase(), secret).not.toContain(secret.toLowerCase())
    for (const needed of sample.mustKeep) expect(redacted, needed).toContain(needed)

    expect(findLeaks(redacted, registry)).toEqual([])

    // Every placeholder can be put back. (A surname on its own comes back as
    // the full name, so the result is not character-identical to the input.)
    const restored = registry.rehydrate(redacted)
    expect(restored).not.toMatch(/\[[A-Z_]+_\d+\]/)
    for (const secret of sample.mustHide) expect(restored.toLowerCase(), secret).toContain(secret.toLowerCase())
  })

  it.each(cases)('regex alone leaves gaps in the $name that the leak guard cannot see', async (sample) => {
    // Without Nano the registry does not know about unlabelled names and
    // addresses, so they are neither redacted nor blocked. This is why the
    // app shows a "reduced protection" banner in regex-only mode.
    const { spans } = await detectDocument(sample.text)
    const registry = new Registry()
    registry.addSpans(spans)
    const redacted = registry.redact(sample.text)
    const missed = sample.mustHide.filter((secret) => redacted.includes(secret))
    expect(findLeaks(redacted, registry)).toEqual([])
    if (sample.name === 'lab report') {
      // Its only unlabelled detail is a street address ending in a PIN code,
      // which the address-shape pattern recognises without a model.
      expect(missed).toEqual([])
    } else {
      expect(missed.length).toBeGreaterThan(0)
    }
  })
})
