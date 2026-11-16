import { describe, expect, it } from 'vitest'
import type { NanoDetector } from '../../privacy/detect'
import { detectWithRegex } from '../../privacy/regex'
import { locateAll } from '../../privacy/spans'
import type { Span } from '../../privacy/types'
import { normaliseText } from '../ingest/readFile'
import { EVAL_CORPUS, type EvalDocument, type Planted } from './corpus'
import { formatMs, formatPercent, runEval, scoreDocument, summarise, toMarkdown } from './score'

const spanFor = (text: string, value: string, type: Span['type'] = 'PERSON'): Span[] =>
  locateAll(text, value).map((hit) => ({ ...hit, type, source: 'nano' as const }))

/** A stand-in for Gemini Nano that finds every planted detail. Unit tests only. */
const perfectNano =
  (planted: Planted[]): NanoDetector =>
  async (chunk) => {
    const flat = chunk.replace(/\s+/g, ' ').toLowerCase()
    return planted
      .flatMap((detail) => [detail.value, ...(detail.alsoWrittenAs ?? [])].map((text) => ({ text, type: detail.type })))
      .filter((finding) => flat.includes(finding.text.toLowerCase()))
  }

describe('scoreDocument', () => {
  const text = 'Asha Verma lives at 4 Hill Road. Call Asha Verma on 98765 43210. Mrs. Verma agreed.'
  const planted: Planted[] = [
    { value: 'Asha Verma', type: 'PERSON', alsoWrittenAs: ['Verma'] },
    { value: '4 Hill Road', type: 'ADDRESS' },
    { value: '98765 43210', type: 'CONTACT' },
  ]

  it('counts everything as leaked when nothing was detected', () => {
    const score = scoreDocument(text, planted, [])
    expect(score.planted).toBe(3)
    expect(score.hidden).toBe(0)
    expect(score.leaked.map((detail) => detail.planted.value)).toEqual(['Asha Verma', '4 Hill Road', '98765 43210'])
  })

  it('counts a detail as hidden when every occurrence is covered', () => {
    const spans = [...spanFor(text, 'Asha Verma'), ...spanFor(text, '4 Hill Road', 'ADDRESS'), ...spanFor(text, '98765 43210', 'CONTACT')]
    const score = scoreDocument(text, planted, spans)
    expect(score.hidden).toBe(3)
    expect(score.leaked).toEqual([])
  })

  it('counts a partly covered detail as leaked and reports how much is visible', () => {
    const spans = spanFor(text, '4 Hill', 'ADDRESS')
    const score = scoreDocument(text, [planted[1]], spans)
    expect(score.hidden).toBe(0)
    expect(score.leaked[0]).toMatchObject({ visibleChars: 4, totalChars: 9, occurrences: 1 })
  })

  it('counts a detail as leaked if any one occurrence is missed', () => {
    const lonely = 'Ravi Menon signed. Later, ravi menon paid. Mr. Menon left.'
    const detail: Planted = { value: 'Ravi Menon', type: 'PERSON', alsoWrittenAs: ['Menon'] }
    // Only the first occurrence is covered by this hand-made span.
    const first = locateAll(lonely, 'Ravi Menon')[0]
    const registryWouldCoverAll = scoreDocument(lonely, [detail], [{ ...first, type: 'PERSON', source: 'nano' }])
    // The registry replaces every occurrence of a registered value, and the
    // surname alone, so one finding hides them all.
    expect(registryWouldCoverAll.hidden).toBe(1)

    const surnameOnly = scoreDocument('Ravi Menon signed.', [detail], spanFor('Ravi Menon signed.', 'Ravi'))
    expect(surnameOnly.hidden).toBe(0)
    expect(surnameOnly.leaked[0].visibleChars).toBe(5)
  })

  it('ignores punctuation and spaces when deciding if a detail is covered', () => {
    const phone = 'Phone: (080) 4123 5567 today'
    const score = scoreDocument(phone, [{ value: '(080) 4123 5567', type: 'CONTACT' }], spanFor(phone, '080) 4123 5567', 'CONTACT'))
    expect(score.hidden).toBe(1)
  })

  it('does not count a plain date as hidden, because dates stay visible by default', () => {
    const doc = 'Due on 10 February 2027.'
    const score = scoreDocument(doc, [{ value: '10 February 2027', type: 'DATE_OF_BIRTH' }], spanFor(doc, '10 February 2027', 'DATE'))
    expect(score.hidden).toBe(0)
  })

  it('reports planted details that are not in the text as a corpus mistake', () => {
    const score = scoreDocument(text, [...planted, { value: 'Nobody Here', type: 'PERSON' }], [])
    expect(score.missing.map((detail) => detail.value)).toEqual(['Nobody Here'])
    expect(score.planted).toBe(3)
  })

  it('counts other hidden items that were not planted', () => {
    const doc = 'Asha Verma of Coastal Bank wrote.'
    const score = scoreDocument(doc, [{ value: 'Asha Verma', type: 'PERSON' }], [...spanFor(doc, 'Asha Verma'), ...spanFor(doc, 'Coastal Bank', 'ORG')])
    expect(score.hidden).toBe(1)
    expect(score.extraHidden).toBe(1)
  })
})

describe('the leak test corpus', () => {
  it('has ten documents with unique ids', () => {
    expect(EVAL_CORPUS).toHaveLength(10)
    expect(new Set(EVAL_CORPUS.map((document) => document.id)).size).toBe(10)
  })

  it.each(EVAL_CORPUS)('$id: every planted detail really appears in the text', (document) => {
    const text = normaliseText(document.text)
    expect(document.planted.length).toBeGreaterThanOrEqual(5)
    for (const detail of document.planted) {
      for (const form of [detail.value, ...(detail.alsoWrittenAs ?? [])]) {
        expect(locateAll(text, form).length, form).toBeGreaterThan(0)
      }
    }
    expect(scoreDocument(text, document.planted, []).missing).toEqual([])
  })

  it.each(EVAL_CORPUS)('$id: is short enough for one on-device call', (document) => {
    expect(normaliseText(document.text).length).toBeLessThan(1800)
  })

  it.each(EVAL_CORPUS)('$id: a detector that finds every planted detail scores zero leaks', async (document) => {
    const [row] = await runEval([document], { nano: perfectNano(document.planted), prepare: normaliseText })
    expect(row.nano?.score.leaked.map((detail) => detail.planted.value)).toEqual([])
    expect(row.nano?.score.hidden).toBe(document.planted.length)
  })

  it('regex alone hides the shaped details but leaks names and addresses written in sentences', async () => {
    const rows = await runEval(EVAL_CORPUS, { prepare: normaliseText })
    const summary = summarise(rows)
    const leakedTypes = new Set(rows.flatMap((row) => row.regex.score.leaked.map((detail) => detail.planted.type)))

    expect(summary.nano).toBeNull()
    expect(summary.regex.leaked).toBeGreaterThan(0)
    expect(summary.regex.leakRate).toBeLessThan(0.6)
    expect(leakedTypes.has('ADDRESS')).toBe(true)
    expect(leakedTypes.has('PERSON')).toBe(true)

    // Emails and PAN numbers have a fixed shape: regex must never miss them.
    for (const row of rows) {
      for (const detail of row.regex.score.leaked) {
        expect(detail.planted.value, row.id).not.toMatch(/@|^[A-Z]{5}\d{4}[A-Z]$/)
      }
    }
  })

  it('agrees with the regex detector run directly', () => {
    const document = EVAL_CORPUS[0]
    const text = normaliseText(document.text)
    const direct = scoreDocument(text, document.planted, detectWithRegex(text))
    expect(direct.planted).toBe(document.planted.length)
  })
})

describe('runEval', () => {
  const corpus: EvalDocument[] = [
    { id: 'a', title: 'First', text: 'Asha Verma, asha@mail.example', planted: [{ value: 'Asha Verma', type: 'PERSON' }, { value: 'asha@mail.example', type: 'CONTACT' }] },
    { id: 'b', title: 'Second', text: 'Signed by someone called Ravi Menon today', planted: [{ value: 'Ravi Menon', type: 'PERSON' }] },
  ]

  it('runs regex only when no model is given', async () => {
    const rows = await runEval(corpus)
    expect(rows.map((row) => row.nano)).toEqual([null, null])
    expect(rows[0].regex.score.leaked.map((detail) => detail.planted.value)).toEqual(['Asha Verma'])
    expect(rows[1].regex.score.leaked).toHaveLength(1)
  })

  it('runs both methods, times them, and reports progress', async () => {
    let clock = 0
    const progress: number[] = []
    const rows = await runEval(corpus, {
      nano: async (chunk) => {
        clock += 2000
        return perfectNano(corpus.flatMap((document) => document.planted))(chunk)
      },
      now: () => clock,
      onProgress: (done) => progress.push(done),
    })

    expect(progress).toEqual([1, 2])
    expect(rows.every((row) => row.nano?.score.leaked.length === 0)).toBe(true)
    expect(rows[0].nano?.ms).toBe(2000)
    expect(rows[0].regex.ms).toBe(0)
  })

  it('records chunks where the model failed and still scores the document', async () => {
    const rows = await runEval(corpus, {
      nano: async () => {
        throw new Error('model crashed')
      },
    })
    expect(rows[0].nano?.failures).toBe(1)
    expect(rows[0].nano?.score.leaked.map((detail) => detail.planted.value)).toEqual(['Asha Verma'])
  })

  it('stops early when aborted', async () => {
    const controller = new AbortController()
    const rows = await runEval(corpus, { signal: controller.signal, onProgress: () => controller.abort() })
    expect(rows).toHaveLength(1)
  })
})

describe('summarise and toMarkdown', () => {
  const result = (leaked: number, ms: number, planted = 4) => ({
    score: {
      planted,
      hidden: planted - leaked,
      leaked: Array.from({ length: leaked }, () => ({ planted: { value: 'x', type: 'PERSON' as const }, occurrences: 1, visibleChars: 1, totalChars: 1, hidden: false })),
      missing: [],
      extraHidden: 1,
    },
    ms,
    failures: 0,
  })

  const rows = [
    { id: 'a', title: 'Lab report', planted: 4, regex: result(2, 1), nano: result(0, 3000) },
    { id: 'b', title: 'Loan letter', planted: 4, regex: result(1, 3), nano: result(1, 5000) },
  ]

  it('totals leaks and averages time per document', () => {
    const summary = summarise(rows)
    expect(summary).toMatchObject({ documents: 2, planted: 8 })
    expect(summary.regex).toMatchObject({ leaked: 3, leakRate: 0.375, msPerDocument: 2, extraHidden: 2 })
    expect(summary.nano).toMatchObject({ leaked: 1, leakRate: 0.125, msPerDocument: 4000 })
  })

  it('leaves the model column out unless it ran on every document', () => {
    expect(summarise([rows[0], { ...rows[1], nano: null }]).nano).toBeNull()
    expect(summarise([]).nano).toBeNull()
    expect(summarise([]).regex.leakRate).toBe(0)
  })

  it('formats percentages and times', () => {
    expect(formatPercent(0.375)).toBe('37.5%')
    expect(formatMs(0.2)).toBe('<1 ms')
    expect(formatMs(420)).toBe('420 ms')
    expect(formatMs(4000)).toBe('4.0 s')
  })

  it('writes a Markdown table with both methods', () => {
    expect(toMarkdown(rows)).toBe(
      [
        '| Document | Planted details | Leaked: regex only | Leaked: regex + Gemini Nano | Time: regex + Nano |',
        '| --- | ---: | ---: | ---: | ---: |',
        '| Lab report | 4 | 2 | 0 | 3.0 s |',
        '| Loan letter | 4 | 1 | 1 | 5.0 s |',
        '| **Total (2 documents)** | **8** | **3 (37.5%)** | **1 (12.5%)** | **4.0 s per document** |',
      ].join('\n'),
    )
  })

  it('writes a regex-only table when the model did not run', () => {
    const regexOnly = rows.map((row) => ({ ...row, nano: null }))
    expect(toMarkdown(regexOnly)).toBe(
      [
        '| Document | Planted details | Leaked: regex only |',
        '| --- | ---: | ---: |',
        '| Lab report | 4 | 2 |',
        '| Loan letter | 4 | 1 |',
        '| **Total (2 documents)** | **8** | **3 (37.5%)** |',
      ].join('\n'),
    )
  })
})
