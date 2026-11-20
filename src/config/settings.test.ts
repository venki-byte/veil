import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, isModelProblem, isValidModelName, parseConfig } from './settings'

describe('isValidModelName', () => {
  it.each(['gemini-4-hydrogen', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'])('accepts %s', (name) => {
    expect(isValidModelName(name)).toBe(true)
  })

  it.each(['', 'gpt-5', 'GEMINI-4', 'gemini-', 'gemini 4', 'gemini-4-hydrogen; drop', undefined, 42])('rejects %j', (name) => {
    expect(isValidModelName(name)).toBe(false)
  })
})

describe('parseConfig', () => {
  it('uses the defaults when there is no remote config', () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG.modelName).toBe('gemini-4-hydrogen')
    expect(DEFAULT_CONFIG.detectionPasses).toBe(2)
  })

  it('takes valid values from Remote Config and says so', () => {
    expect(parseConfig({ modelName: 'gemini-3.8-flash', detectionPasses: '1' })).toEqual({
      ...DEFAULT_CONFIG,
      modelName: 'gemini-3.8-flash',
      detectionPasses: 1,
      source: 'remote config',
    })
  })

  it('reports "defaults" when Remote Config only repeats the defaults', () => {
    expect(parseConfig({ modelName: 'gemini-4-hydrogen', detectionPasses: '2' }).source).toBe('defaults')
  })

  it('ignores invalid remote values instead of breaking', () => {
    expect(parseConfig({ modelName: 'not a model', detectionPasses: 'three' })).toEqual(DEFAULT_CONFIG)
    expect(parseConfig({ modelName: '', detectionPasses: '' })).toEqual(DEFAULT_CONFIG)
  })

  it('lets a model set in .env win, for local testing', () => {
    const config = parseConfig({ modelName: 'gemini-3.8-flash' }, 'gemini-3.5-flash-lite')
    expect(config.modelName).toBe('gemini-3.5-flash-lite')
    expect(config.source).toBe('.env')
  })

  it('ignores an empty or invalid .env model', () => {
    expect(parseConfig(null, '').modelName).toBe('gemini-4-hydrogen')
    expect(parseConfig(null, 'gpt-5').source).toBe('defaults')
  })

  it('always keeps the fallback model', () => {
    expect(parseConfig({ modelName: 'gemini-3.8-flash' }).fallbackModel).toBe('gemini-3.5-flash-lite')
  })
})

describe('isModelProblem', () => {
  it.each([
    'Error fetching from https://firebasevertexai.googleapis.com/...: [404 Not Found] models/gemini-4-hydrogen is not found',
    '[429 Too Many Requests] Resource has been exhausted (e.g. check quota).',
    'This model requires billing to be enabled.',
    '[503 Service Unavailable] The model is overloaded. Please try again later.',
    'The model gemini-4-hydrogen is not supported for generateContent.',
    'The cloud model is rate-limited right now. Wait a minute and try again.'.replace('rate-limited', 'quota exceeded'),
  ])('treats %j as a model problem', (message) => {
    expect(isModelProblem(message)).toBe(true)
  })

  it.each([
    'The cloud refused the request. This usually means App Check is not set up for this site yet.',
    'You are offline, and this step needs the cloud.',
    'TypeError: Failed to fetch',
    'Blocked before sending: the outgoing text still contains [PERSON_1].',
    'The explanation came back empty. Please try again.',
  ])('does not treat %j as a model problem', (message) => {
    expect(isModelProblem(message)).toBe(false)
  })
})
