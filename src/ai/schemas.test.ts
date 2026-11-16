import { describe, expect, it } from 'vitest'
import {
  detectionSchema,
  explanationSchema,
  parseDetection,
  parseExplanation,
  parseJson,
  toCloudSchema,
} from './schemas'

describe('parseJson', () => {
  it('parses plain JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('tolerates a code fence around the JSON', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJson('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('tolerates chatter before and after the JSON', () => {
    expect(parseJson('Here you go: {"a":{"b":2}} Hope that helps.')).toEqual({ a: { b: 2 } })
  })

  it('throws on text with no JSON in it', () => {
    expect(() => parseJson('I cannot help with that.')).toThrow()
  })
})

describe('parseDetection', () => {
  it('returns the spans the model listed', () => {
    const text = JSON.stringify({ spans: [{ text: 'Asha Verma', type: 'PERSON' }, { text: ' 4 Hill Road ', type: 'ADDRESS' }] })
    expect(parseDetection(text)).toEqual([
      { text: 'Asha Verma', type: 'PERSON' },
      { text: '4 Hill Road', type: 'ADDRESS' },
    ])
  })

  it('returns an empty list when there are no spans', () => {
    expect(parseDetection('{"spans":[]}')).toEqual([])
    expect(parseDetection('{}')).toEqual([])
    expect(parseDetection('{"spans":"none"}')).toEqual([])
  })

  it('drops malformed items instead of failing', () => {
    const text = JSON.stringify({ spans: [null, 7, { type: 'PERSON' }, { text: '' }, { text: 'Rao' }] })
    expect(parseDetection(text)).toEqual([{ text: 'Rao', type: '' }])
  })
})

describe('parseExplanation', () => {
  const full = {
    documentType: 'Blood test report',
    summary: 'A report for [PERSON_1].',
    keyTerms: [{ term: 'HbA1c', meaning: 'Average blood sugar.' }],
    thingsToWatch: [{ title: 'Low haemoglobin', detail: 'Marked LOW.' }],
    deadlinesAndAmounts: [{ label: 'HbA1c', value: '7.1 %', note: 'Above range.' }],
    questionsToAsk: ['Should this be repeated?'],
  }

  it('returns a complete explanation unchanged', () => {
    expect(parseExplanation(JSON.stringify(full))).toEqual(full)
  })

  it('fills in defaults for missing optional parts', () => {
    const parsed = parseExplanation('{"summary":"Just a summary."}')
    expect(parsed).toEqual({
      documentType: 'Document',
      summary: 'Just a summary.',
      keyTerms: [],
      thingsToWatch: [],
      deadlinesAndAmounts: [],
      questionsToAsk: [],
    })
  })

  it('drops incomplete list items', () => {
    const parsed = parseExplanation(
      JSON.stringify({
        ...full,
        keyTerms: [{ term: 'MCV' }, { term: 'TSH', meaning: 'A hormone.' }, 'junk'],
        deadlinesAndAmounts: [{ label: 'Fee' }, { label: 'EMI', value: 'Rs. 55,180' }],
        questionsToAsk: ['', 'Why?', 5],
      }),
    )
    expect(parsed.keyTerms).toEqual([{ term: 'TSH', meaning: 'A hormone.' }])
    expect(parsed.deadlinesAndAmounts).toEqual([{ label: 'EMI', value: 'Rs. 55,180', note: '' }])
    expect(parsed.questionsToAsk).toEqual(['Why?'])
  })

  it('refuses an explanation with no summary', () => {
    expect(() => parseExplanation('{"documentType":"Letter","summary":"  "}')).toThrow()
  })
})

describe('toCloudSchema', () => {
  it('removes keywords the cloud schema does not accept, at every depth', () => {
    const cloud = toCloudSchema(detectionSchema)
    expect(JSON.stringify(cloud)).not.toContain('additionalProperties')
    expect(cloud).toMatchObject({
      type: 'object',
      required: ['spans'],
      properties: { spans: { type: 'array', items: { type: 'object', required: ['text', 'type'] } } },
    })
  })

  it('keeps enums and required lists intact', () => {
    const cloud = toCloudSchema(detectionSchema) as {
      properties: { spans: { items: { properties: { type: { enum: string[] } } } } }
    }
    expect(cloud.properties.spans.items.properties.type.enum).toContain('PERSON')
  })

  it('leaves a schema without those keywords unchanged', () => {
    expect(toCloudSchema(explanationSchema)).toEqual(explanationSchema)
  })

  it('does not modify its input', () => {
    const before = JSON.stringify(detectionSchema)
    toCloudSchema(detectionSchema)
    expect(JSON.stringify(detectionSchema)).toBe(before)
  })
})
