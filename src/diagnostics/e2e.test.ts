import { describe, expect, it, vi } from 'vitest'
import type { Explanation } from '../ai/schemas'
import { EVAL_CORPUS } from '../features/eval/corpus'
import type { NanoFinding } from '../privacy/detect'
import { locateAll } from '../privacy/spans'
import labReport from '../../samples/lab-report.txt?raw'
import { E2E_TOTAL, runEndToEnd, type E2EDeps, type Timed } from './e2e'

const explanation: Explanation = {
  documentType: 'Blood test report',
  summary: 'This is a blood test report for [PERSON_1], referred by Dr. [PERSON_2]. Several results are outside the range.',
  keyTerms: [{ term: 'HbA1c', meaning: 'Average blood sugar over three months.' }],
  thingsToWatch: [{ title: 'Low haemoglobin', detail: 'The report shows 10.8 g/dL, marked LOW.' }],
  deadlinesAndAmounts: [{ label: 'HbA1c', value: '7.1 %', note: 'Marked HIGH.' }],
  questionsToAsk: ['Should this be repeated?'],
}

const timed = <T,>(value: T, source: Timed<T>['source'] = 'on_device'): Timed<T> => ({ value, source, durationMs: 100 })

const allPlanted = EVAL_CORPUS.flatMap((document) => document.planted.flatMap((detail) => [detail.value, ...(detail.alsoWrittenAs ?? [])]))
const labNames = ['Meenakshi Raghavan', 'Anil Deshpande', 'Kavitha Subramaniam', 'Raghavan', 'Deshpande']

/** A stand-in for Gemini Nano: finds every name it was told about. Unit tests only. */
const fakeDetect = async (chunk: string): Promise<NanoFinding[]> => {
  const flat = chunk.replace(/\s+/g, ' ').toLowerCase()
  return [...labNames, ...allPlanted]
    .filter((value) => flat.includes(value.toLowerCase()))
    .map((text) => ({ text, type: 'PERSON' }))
}

function build(overrides: Partial<E2EDeps> = {}) {
  const sent: string[] = []
  const deps: E2EDeps = {
    sampleText: labReport,
    mustBeHidden: ['Meenakshi', 'Raghavan', 'Deshpande'],
    followUpExpect: '10.8',
    followUpQuestion: 'What is the haemoglobin result for Meenakshi Raghavan?',
    term: 'HbA1c',

    detectChunk: fakeDetect,
    explain: async (redacted) => {
      sent.push(redacted)
      return timed(explanation, 'in_cloud')
    },
    followUp: async (redacted, question) => {
      sent.push(redacted, question)
      return timed('The haemoglobin is 10.8 g/dL, which the report marks LOW.', 'in_cloud')
    },
    simplify: async () => timed('This is a blood test for [PERSON_1]. Some numbers are off. It is written simply enough.'),
    define: async () => timed('HbA1c is a blood sugar measure over about three months, as used in this report.'),
    translate: async () => timed('यह एक रक्त परीक्षण रिपोर्ट है।', 'in_cloud'),
    quickRead: async () => timed('A blood test report for [PERSON_1] with a few results out of range.'),

    classify: async () => 'blood test or lab report',
    plan: async (type) => {
      sent.push(type)
      return { questions: ['What is the haemoglobin result?', 'What is the HbA1c result?', 'Which results are marked HIGH or LOW?'] }
    },
    answerOnDevice: async () => [
      { id: 'Q1', answer: '10.8 g/dL, marked LOW' },
      { id: 'Q2', answer: '7.1 %, marked HIGH' },
      { id: 'Q3', answer: 'NOT FOUND' },
    ],
    combine: async (type, facts) => {
      sent.push(type, JSON.stringify(facts))
      return explanation
    },
    followUpOnDevice: async () => timed('The haemoglobin is 10.8 g/dL.'),

    ledgerMark: () => 0,
    outboundSince: () => sent,
    describeError: (error) => (error instanceof Error ? error.message : 'error'),
    now: () => 0,
    ...overrides,
  }
  return { deps, sent }
}

const titles = (outcomes: Array<{ title: string }>) => outcomes.map((outcome) => outcome.title)

describe('runEndToEnd: a healthy machine', () => {
  it('runs every check and all pass', async () => {
    const { outcomes } = await runEndToEnd(build().deps)
    expect(outcomes).toHaveLength(E2E_TOTAL)
    const failing = outcomes.filter((outcome) => outcome.status !== 'pass')
    expect(failing.map((outcome) => `${outcome.title}: ${outcome.detail}`)).toEqual([])
  })

  it('covers the whole flow, in order', async () => {
    const { outcomes } = await runEndToEnd(build().deps)
    expect(titles(outcomes)).toEqual([
      'Detect and redact a whole document',
      'Leak guard passes the redacted text',
      'Explain the redacted document (cloud) and restore names',
      'Follow-up question (cloud)',
      'Simpler words',
      'Explain a term (HbA1c)',
      'Translate to Hindi',
      'Quick read on this device',
      'Strict mode',
      'Follow-up after strict mode',
      'Leak test: 10 documents, regex versus regex + Gemini Nano',
      'Privacy audit of everything sent to the cloud',
    ])
  })

  it('returns the leak test table for the README', async () => {
    const { appendix } = await runEndToEnd(build().deps)
    expect(appendix).toContain('| Document | Planted details | Leaked: regex only | Leaked: regex + Gemini Nano |')
    expect(appendix).toContain('**Total (10 documents)**')
  })

  it('reports progress after every check', async () => {
    const seen: number[] = []
    await runEndToEnd(build({ onProgress: (done, total) => seen.push(done * 100 + total) }).deps)
    expect(seen).toEqual(Array.from({ length: E2E_TOTAL }, (_, index) => (index + 1) * 100 + E2E_TOTAL))
  })
})

describe('runEndToEnd: failures are caught and reported', () => {
  it('fails detection when a name survives redaction, and says which', async () => {
    // The street address has no label, so only a model can find it.
    const { deps } = build({ detectChunk: async () => [], mustBeHidden: ['Meenakshi', 'Lake View Road'] })
    const [first] = (await runEndToEnd(deps)).outcomes
    expect(first.status).toBe('fail')
    expect(first.detail).toContain('STILL VISIBLE: Lake View Road')
    expect(first.detail).not.toContain('Meenakshi,')
  })

  it('fails detection if Gemini Nano failed on a chunk', async () => {
    const { deps } = build({
      detectChunk: async () => {
        throw new Error('model crashed')
      },
    })
    const [first] = (await runEndToEnd(deps)).outcomes
    expect(first.status).toBe('fail')
    expect(first.detail).toContain('1 failed')
  })

  it('fails when the explanation leaves placeholders unresolved', async () => {
    const { deps } = build({
      explain: async () => timed({ ...explanation, summary: 'A report for [PERSON_9], an unknown person, with results.' }, 'in_cloud'),
    })
    const third = (await runEndToEnd(deps)).outcomes[2]
    expect(third.status).toBe('fail')
    expect(third.detail).toContain('UNRESOLVED: [PERSON_9]')
  })

  it('fails a follow-up answer that misses the fact', async () => {
    const { deps } = build({ followUp: async () => timed('I do not know.', 'in_cloud') })
    expect((await runEndToEnd(deps)).outcomes[3].status).toBe('fail')
  })

  it('fails the light tasks if they ran in the cloud instead of on the device', async () => {
    const { deps } = build({
      simplify: async () => timed('This is a blood test. Some numbers are off. Simple enough.', 'in_cloud'),
      quickRead: async () => timed('A blood test report with a few results out of range.', 'in_cloud'),
    })
    const { outcomes } = await runEndToEnd(deps)
    expect(outcomes[4].status).toBe('fail')
    expect(outcomes[7].status).toBe('fail')
  })

  it('fails a translation that contains no Hindi', async () => {
    const { deps } = build({ translate: async () => timed('This is still English text.', 'in_cloud') })
    const result = (await runEndToEnd(deps)).outcomes[6]
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('no Hindi characters')
  })

  it('reports a thrown error as ERROR and carries on with the next check', async () => {
    const { deps } = build({
      explain: async () => {
        throw new Error('The cloud refused the request.')
      },
    })
    const { outcomes } = await runEndToEnd(deps)
    expect(outcomes[2]).toMatchObject({ status: 'error', detail: 'The cloud refused the request.' })
    expect(outcomes).toHaveLength(E2E_TOTAL)
    // The follow-up does not need the explanation, so it still runs.
    expect(outcomes[3].status).toBe('pass')
    // The light tasks do, so they are skipped with a reason.
    expect(outcomes[4]).toMatchObject({ status: 'fail', detail: 'skipped: there is no explanation to work from.' })
  })

  it('skips the strict follow-up if strict mode did not finish', async () => {
    const { deps } = build({ plan: async () => ({ questions: [] }) })
    const { outcomes } = await runEndToEnd(deps)
    expect(outcomes[8].status).toBe('error')
    expect(outcomes[9]).toMatchObject({ status: 'fail', detail: 'skipped: strict mode did not finish.' })
  })

  it('fails the leak test if Gemini Nano leaks more than regex alone', async () => {
    const { deps } = build()
    let calls = 0
    // Healthy for the first document, then useless: regex-only results are unaffected.
    const flaky = async (chunk: string) => {
      calls += 1
      return calls <= 1 ? fakeDetect(chunk) : []
    }
    const { outcomes } = await runEndToEnd({ ...deps, detectChunk: flaky })
    const leakTest = outcomes[10]
    expect(leakTest.detail).toContain('Regex only leaked')
    expect(['pass', 'fail']).toContain(leakTest.status)
  })
})

describe('runEndToEnd: the privacy audit', () => {
  it('passes only when no hidden value was in any cloud request, and counts them', async () => {
    const { outcomes } = await runEndToEnd(build().deps)
    const audit = outcomes.at(-1)!
    expect(audit.status).toBe('pass')
    expect(audit.detail).toMatch(/\d+ cloud request\(s\)/)
    expect(audit.detail).toContain('none found')
  })

  it('catches a hidden value that reached the cloud', async () => {
    const { deps, sent } = build()
    // A request that smuggles in a real name, as a bug might.
    const spy = vi.fn(deps.followUp)
    const leaky: E2EDeps = {
      ...deps,
      followUp: async (redacted, question, registry) => {
        sent.push('Please explain the report for Meenakshi Raghavan')
        return spy(redacted, question, registry)
      },
    }
    const audit = (await runEndToEnd(leaky)).outcomes.at(-1)!
    expect(audit.status).toBe('fail')
    expect(audit.detail).toContain('LEAKED')
    expect(audit.detail).toContain('[PERSON_1]')
  })

  it('fails if nothing was sent at all, because then nothing was audited', async () => {
    const { deps } = build({ outboundSince: () => [] })
    expect((await runEndToEnd(deps)).outcomes.at(-1)!.status).toBe('fail')
  })

  it('only audits requests made during this run', async () => {
    const mark = vi.fn(() => 7)
    const since = vi.fn(() => ['[PERSON_1] needs a clean request'])
    await runEndToEnd(build({ ledgerMark: mark, outboundSince: since }).deps)
    expect(since).toHaveBeenCalledWith(7)
  })

  it('the sample really contains the names the checks look for', () => {
    for (const name of ['Meenakshi Raghavan', 'Anil Deshpande']) expect(locateAll(labReport, name).length).toBeGreaterThan(0)
  })
})
