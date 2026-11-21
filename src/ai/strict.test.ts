import { describe, expect, it, vi } from 'vitest'
import { Registry } from '../privacy/registry'
import rental from '../../samples/rental-agreement.txt?raw'
import { strictAnswerPrompt, strictCombinePrompt, strictPlanPrompt } from './prompts'
import type { Explanation } from './schemas'
import { parseAnswers, parseClassification } from './schemas'
import {
  cleanDocumentType,
  cleanQuestions,
  DOCUMENT_TYPES,
  isNotFound,
  MAX_FACT_CHARS,
  MAX_QUESTION_CHARS,
  MAX_QUESTIONS,
  MAX_RETRY_CALLS,
  mergeAnswers,
  runStrict,
  StrictModeError,
  type StrictDeps,
  type StrictStep,
} from './strict'

const explanation: Explanation = {
  documentType: 'Rental agreement',
  summary: 'A rental agreement.',
  keyTerms: [],
  thingsToWatch: [],
  deadlinesAndAmounts: [],
  questionsToAsk: [],
}

describe('cleanDocumentType', () => {
  it('accepts exactly the fixed labels, ignoring case and outer spaces', () => {
    expect(cleanDocumentType('loan document')).toBe('loan document')
    expect(cleanDocumentType('  Rental or Lease Agreement ')).toBe('rental or lease agreement')
  })

  it('turns anything else into "other document", so no free text can pass', () => {
    expect(cleanDocumentType('loan document for Asha Verma, PAN ABCPK4821L')).toBe('other document')
    expect(cleanDocumentType('')).toBe('other document')
    expect(cleanDocumentType(null)).toBe('other document')
    expect(cleanDocumentType({ documentType: 'loan document' })).toBe('other document')
  })
})

describe('cleanQuestions', () => {
  it('accepts a list of strings or objects, with or without the wrapper', () => {
    const expected = [
      { id: 'Q1', question: 'What is the monthly rent?' },
      { id: 'Q2', question: 'How long is the lock-in period?' },
    ]
    expect(cleanQuestions({ questions: ['What is the monthly rent?', 'How long is the lock-in period?'] })).toEqual(expected)
    expect(cleanQuestions(['What is the monthly rent?', { question: 'How long is the lock-in period?' }])).toEqual(expected)
  })

  it('strips numbering and bullets, and collapses spacing', () => {
    expect(cleanQuestions(['1. What is  the\nmonthly rent?', '- What is the deposit amount?', 'Q3: When does it end?'])).toEqual([
      { id: 'Q1', question: 'What is the monthly rent?' },
      { id: 'Q2', question: 'What is the deposit amount?' },
      { id: 'Q3', question: 'When does it end?' },
    ])
  })

  it('drops duplicates, blanks, fragments and non-strings', () => {
    const cleaned = cleanQuestions(['What is the monthly rent?', 'what is the monthly rent?', '', 'Why?', 7, null, { text: 'x' }])
    expect(cleaned).toEqual([{ id: 'Q1', question: 'What is the monthly rent?' }])
  })

  it('caps the number and length of questions', () => {
    const many = Array.from({ length: 25 }, (_, index) => `What is the value of item number ${index}?`)
    expect(cleanQuestions(many)).toHaveLength(MAX_QUESTIONS)

    const [long] = cleanQuestions([`What is ${'very '.repeat(100)}long?`])
    expect(long.question.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS + 1)
  })

  it('returns nothing for unusable input', () => {
    expect(cleanQuestions(null)).toEqual([])
    expect(cleanQuestions('What is the rent?')).toEqual([])
    expect(cleanQuestions({ questions: 'none' })).toEqual([])
  })
})

describe('isNotFound', () => {
  it.each(['NOT FOUND', 'not found.', 'Not Found', 'N/A', 'n/a', 'None', 'Unknown', 'Not mentioned', 'Not stated.', 'not in the excerpt', '', '  ', '"NOT FOUND"'])(
    'treats %j as no answer',
    (answer) => {
      expect(isNotFound(answer)).toBe(true)
    },
  )

  it.each(['Rs. 32,000 per month', 'None of the parties may sublet', '11 months', 'Not refundable', '0'])('treats %j as an answer', (answer) => {
    expect(isNotFound(answer)).toBe(false)
  })

  it('treats non-strings as no answer', () => {
    expect(isNotFound(undefined)).toBe(true)
    expect(isNotFound(42)).toBe(true)
  })
})

describe('mergeAnswers', () => {
  const questions = [
    { id: 'Q1', question: 'What is the monthly rent?' },
    { id: 'Q2', question: 'What is the deposit?' },
    { id: 'Q3', question: 'Is there a pet clause?' },
  ]
  const same = (text: string) => text

  it('keeps the answers that were found and drops unanswered questions', () => {
    const facts = mergeAnswers(
      questions,
      [
        [{ id: 'Q1', answer: 'Rs. 32,000 per month' }, { id: 'Q2', answer: 'NOT FOUND' }, { id: 'Q3', answer: 'NOT FOUND' }],
        [{ id: 'Q1', answer: 'NOT FOUND' }, { id: 'Q2', answer: 'Rs. 1,50,000' }, { id: 'Q3', answer: 'n/a' }],
      ],
      same,
    )
    expect(facts).toEqual([
      { id: 'Q1', question: 'What is the monthly rent?', answer: 'Rs. 32,000 per month' },
      { id: 'Q2', question: 'What is the deposit?', answer: 'Rs. 1,50,000' },
    ])
  })

  it('joins different answers from different chunks and removes repeats', () => {
    const facts = mergeAnswers(
      [questions[0]],
      [[{ id: 'Q1', answer: 'Rs. 32,000 per month' }], [{ id: 'Q1', answer: 'rs. 32,000 per month.' }], [{ id: 'Q1', answer: 'Late fee Rs. 200 per day' }]],
      same,
    )
    expect(facts[0].answer).toBe('Rs. 32,000 per month; Late fee Rs. 200 per day')
  })

  it('caps the length of what can be sent for one question', () => {
    const facts = mergeAnswers([questions[0]], [[{ id: 'Q1', answer: 'word '.repeat(200) }]], same)
    expect(facts[0].answer.length).toBeLessThanOrEqual(MAX_FACT_CHARS + 1)
  })

  it('redacts every answer again before it can be sent', () => {
    const registry = new Registry()
    registry.add('Prakash Kulkarni', 'PERSON', 'nano')
    const facts = mergeAnswers(
      [{ id: 'Q1', question: 'Who receives the rent?' }],
      [[{ id: 'Q1', answer: 'Paid to Prakash Kulkarni by the 5th' }]],
      (text) => registry.redact(text),
    )
    expect(facts[0].answer).toBe('Paid to [PERSON_1] by the 5th')
  })

  it('ignores answers to questions that were never asked, and malformed items', () => {
    const facts = mergeAnswers(
      [questions[0]],
      [[{ id: 'Q9', answer: 'Something else' }, null as never, { id: 'Q1', answer: 'Rs. 32,000' }]],
      same,
    )
    expect(facts).toEqual([{ id: 'Q1', question: 'What is the monthly rent?', answer: 'Rs. 32,000' }])
  })
})

describe('parsers for strict mode', () => {
  it('reads a classification from JSON or from a bare label', () => {
    expect(parseClassification('{"documentType":"loan document"}')).toBe('loan document')
    expect(parseClassification('"loan document".')).toBe('loan document')
    expect(parseClassification('{}')).toBe('')
  })

  it('reads answers and normalises their ids', () => {
    expect(parseAnswers('{"answers":[{"id":"q1","answer":" Rs. 5 "},{"id":"Q-2","answer":"NOT FOUND"},{"answer":"x"}]}')).toEqual([
      { id: 'Q1', answer: 'Rs. 5' },
      { id: 'Q2', answer: 'NOT FOUND' },
      { id: 'Q3', answer: 'x' },
    ])
    expect(parseAnswers('{}')).toEqual([])
  })

  it('turns a bare number into a question id and drops empty answers', () => {
    expect(parseAnswers('{"answers":[{"id":"2","answer":"Rs. 1,50,000"},{"id":"Q3","answer":"  "}]}')).toEqual([
      { id: 'Q2', answer: 'Rs. 1,50,000' },
    ])
  })
})

describe('runStrict', () => {
  const document =
    'LEAVE AND LICENSE AGREEMENT between [PERSON_1] and [PERSON_2].\n\n' +
    'The licence fee is Rs. 32,000 per month, payable by the 5th.\n\n' +
    'The deposit is Rs. 1,50,000. Lock-in is 6 months. SECRET-SENTENCE-NEVER-SEND-THIS.'

  /** Fake model calls, wrapped as spies so the tests can see what each one received. */
  const build = (overrides: Partial<StrictDeps> = {}) => ({
    classify: vi.fn<StrictDeps['classify']>(overrides.classify ?? (async () => 'rental or lease agreement')),
    plan: vi.fn<StrictDeps['plan']>(
      overrides.plan ??
        (async () => ({ questions: ['What is the monthly rent?', 'What is the security deposit?', 'Is there a pet clause?'] })),
    ),
    answer: vi.fn<StrictDeps['answer']>(
      overrides.answer ??
        (async (chunk, questions) =>
          questions.map((question) => ({
            id: question.id,
            answer:
              /rent/i.test(question.question) && chunk.includes('32,000')
                ? 'Rs. 32,000 per month'
                : /deposit/i.test(question.question) && chunk.includes('1,50,000')
                  ? 'Rs. 1,50,000'
                  : 'NOT FOUND',
          }))),
    ),
    combine: vi.fn<StrictDeps['combine']>(overrides.combine ?? (async () => explanation)),
    redact: overrides.redact ?? ((text: string) => text),
    onStep: overrides.onStep,
    maxChunkChars: overrides.maxChunkChars,
  })

  it('runs the four steps and returns the explanation with its trail', async () => {
    const deps = build()
    const outcome = await runStrict(document, deps)

    expect(outcome.documentType).toBe('rental or lease agreement')
    expect(outcome.questions).toHaveLength(3)
    expect(outcome.facts).toEqual([
      { id: 'Q1', question: 'What is the monthly rent?', answer: 'Rs. 32,000 per month' },
      { id: 'Q2', question: 'What is the security deposit?', answer: 'Rs. 1,50,000' },
    ])
    expect(outcome.explanation).toBe(explanation)
    expect(outcome.failedChunks).toBe(0)
  })

  it('gives the cloud only the label and the short answers, never the document', async () => {
    const deps = build({ maxChunkChars: 120 })
    await runStrict(document, deps)

    // Everything handed to the two cloud steps:
    const toCloud = JSON.stringify([deps.plan.mock.calls, deps.combine.mock.calls])
    expect(deps.plan.mock.calls).toEqual([['rental or lease agreement']])
    expect(toCloud).not.toContain('SECRET-SENTENCE')
    expect(toCloud).not.toContain('LEAVE AND LICENSE')
    expect(toCloud).not.toContain('payable by the 5th')

    // The document text only ever went to the on-device steps.
    const toDevice = JSON.stringify([deps.classify.mock.calls, deps.answer.mock.calls])
    expect(toDevice).toContain('SECRET-SENTENCE')
  })

  it('the cloud prompts themselves are built without any document text', () => {
    const plan = strictPlanPrompt('rental or lease agreement', MAX_QUESTIONS)
    const combine = strictCombinePrompt('rental or lease agreement', [{ question: 'What is the monthly rent?', answer: 'Rs. 32,000 per month' }])
    for (const prompt of [plan, combine]) {
      expect(prompt).not.toContain('SECRET-SENTENCE')
      expect(prompt).toContain('rental or lease agreement')
    }
    expect(combine).toContain('A: Rs. 32,000 per month')
    // The on-device prompt is the one that carries the excerpt.
    expect(strictAnswerPrompt(document, [{ id: 'Q1', question: 'What is the monthly rent?' }])).toContain('SECRET-SENTENCE')
  })

  it('never passes a free-text label to the cloud', async () => {
    const deps = build({ classify: vi.fn(async () => 'rental agreement of Prakash Kulkarni, Pune') })
    const outcome = await runStrict(document, deps)
    expect(outcome.documentType).toBe('other document')
    expect(deps.plan).toHaveBeenCalledWith('other document')
    expect(DOCUMENT_TYPES).toContain(deps.combine.mock.calls[0][0])
  })

  it('asks the on-device model about every chunk and reports progress', async () => {
    const steps: StrictStep[] = []
    const deps = build({ maxChunkChars: 120, onStep: (step) => steps.push(step) })
    await runStrict(document, deps)

    expect(deps.answer.mock.calls.length).toBeGreaterThan(1)
    for (const [chunk] of deps.answer.mock.calls) expect(chunk.length).toBeLessThanOrEqual(120)
    expect(steps.map((step) => step.step)).toEqual(expect.arrayContaining(['classify', 'plan', 'answer', 'combine']))
    expect(steps[0]).toEqual({ step: 'classify' })
    expect(steps.at(-1)).toEqual({ step: 'combine', documentType: 'rental or lease agreement', facts: 2 })
    const answerSteps = steps.filter((step) => step.step === 'answer')
    const firstRound = deps.answer.mock.calls.filter(([, questions]) => questions.length > 1).length
    expect(answerSteps.at(-1)).toMatchObject({ done: firstRound, total: firstRound })
  })

  it('keeps going when the on-device model fails on one chunk', async () => {
    let call = 0
    const deps = build({
      maxChunkChars: 120,
      answer: vi.fn(async (chunk: string) => {
        call += 1
        if (call === 1) throw new Error('model crashed')
        return [{ id: 'Q2', answer: chunk.includes('1,50,000') ? 'Rs. 1,50,000' : 'NOT FOUND' }]
      }),
    })
    const outcome = await runStrict(document, deps)
    expect(outcome.failedChunks).toBe(1)
    // A retry with one question attributes a single reply to that question,
    // so the deposit answer may also be filed under the question that was
    // re-asked. What matters: the deposit fact is there, and nothing failed hard.
    expect(outcome.facts.some((fact) => fact.answer === 'Rs. 1,50,000')).toBe(true)
  })

  it('re-asks unanswered questions one at a time and keeps the new answers', async () => {
    // First round: the model answers only the first question.
    const answer = vi.fn<StrictDeps['answer']>(async (_chunk, questions) =>
      questions.length > 1
        ? [{ id: 'Q1', answer: 'Rs. 32,000 per month' }]
        : [{ id: questions[0].id, answer: /deposit/i.test(questions[0].question) ? 'Rs. 1,50,000' : 'NOT FOUND' }],
    )
    const outcome = await runStrict(document, build({ answer }))

    expect(outcome.facts.map((fact) => [fact.id, fact.answer])).toEqual([
      ['Q1', 'Rs. 32,000 per month'],
      ['Q2', 'Rs. 1,50,000'],
    ])
    const single = answer.mock.calls.filter(([, questions]) => questions.length === 1).map(([, questions]) => questions[0].id)
    expect(single).toContain('Q2')
    expect(single).toContain('Q3')
    expect(single).not.toContain('Q1')
    expect(outcome.retryCalls).toBe(single.length)
  })

  it('stops re-asking a question once it is answered', async () => {
    const answer = vi.fn<StrictDeps['answer']>(async (_chunk, questions) =>
      questions.length > 1 ? [] : [{ id: questions[0].id, answer: 'Found it' }],
    )
    const outcome = await runStrict(document, build({ answer, maxChunkChars: 120 }))
    const single = answer.mock.calls.filter(([, questions]) => questions.length === 1)
    // Three questions, each answered by the first chunk it is asked about.
    expect(single).toHaveLength(3)
    expect(outcome.facts).toHaveLength(3)
  })

  it('caps the number of retry calls', async () => {
    const plan = vi.fn<StrictDeps['plan']>(async () => ({
      questions: Array.from({ length: 10 }, (_, index) => `What is detail number ${index + 1}?`),
    }))
    const answer = vi.fn<StrictDeps['answer']>(async (_chunk, questions) =>
      questions.length > 1 ? [{ id: 'Q1', answer: 'One' }] : [{ id: questions[0].id, answer: 'NOT FOUND' }],
    )
    const outcome = await runStrict(document, build({ plan, answer, maxChunkChars: 120 }))
    expect(outcome.retryCalls).toBe(MAX_RETRY_CALLS)
    expect(answer.mock.calls.filter(([, questions]) => questions.length === 1)).toHaveLength(MAX_RETRY_CALLS)
  })

  it('stops before the second cloud call when nothing could be answered', async () => {
    const deps = build({ answer: vi.fn(async () => [{ id: 'Q1', answer: 'NOT FOUND' }]) })
    await expect(runStrict(document, deps)).rejects.toBeInstanceOf(StrictModeError)
    expect(deps.combine).not.toHaveBeenCalled()
  })

  it('stops when the cloud returns no usable questions', async () => {
    const deps = build({ plan: vi.fn(async () => ({ questions: [] })) })
    await expect(runStrict(document, deps)).rejects.toBeInstanceOf(StrictModeError)
    expect(deps.answer).not.toHaveBeenCalled()
  })

  it('lets a failure in a cloud step reach the caller', async () => {
    const deps = build({ combine: vi.fn(async () => Promise.reject(new Error('offline'))) })
    await expect(runStrict(document, deps)).rejects.toThrow('offline')
  })

  it('sends far less text than the document on a real sample', async () => {
    const registry = new Registry()
    registry.add('Prakash Kulkarni', 'PERSON', 'nano')
    const redacted = registry.redact(rental)
    const deps = build({ redact: (text) => registry.redact(text) })
    const outcome = await runStrict(redacted, deps)

    const sent = strictPlanPrompt(outcome.documentType, MAX_QUESTIONS) + strictCombinePrompt(outcome.documentType, outcome.facts)
    const answersSent = outcome.facts.map((fact) => fact.answer).join(' ')
    expect(answersSent.length).toBeLessThan(redacted.length / 10)
    expect(sent).not.toContain('Silver Oak')
    expect(sent).not.toContain('Kulkarni')
  })
})
