import { describe, expect, it } from 'vitest'
import {
  definePrompt,
  explainPrompt,
  followUpPrompt,
  placeholderRules,
  placeholdersIn,
  quickReadPrompt,
  simplifyPrompt,
  strictAnswerPrompt,
  strictCombinePrompt,
  translatePrompt,
} from './prompts'

const document = 'Report for [PERSON_1], referred by [PERSON_2]. Call [CONTACT_1]. Haemoglobin 10.8, report dated 10/11/2026.'

describe('placeholdersIn', () => {
  it('lists each distinct placeholder once, in order', () => {
    expect(placeholdersIn('[PERSON_1] met [ORG_2] and [PERSON_1] again, then [DATE_OF_BIRTH_1].')).toEqual([
      '[PERSON_1]',
      '[ORG_2]',
      '[DATE_OF_BIRTH_1]',
    ])
  })

  it('ignores ordinary square brackets', () => {
    expect(placeholdersIn('See [1] and [note] and [person_1] and [PERSON_]')).toEqual([])
  })
})

describe('placeholderRules', () => {
  it('names only the placeholders that are in the text', () => {
    const rules = placeholderRules(document)
    expect(rules).toContain('[PERSON_1], [PERSON_2], [CONTACT_1]')
    expect(rules).not.toContain('[ORG_1]')
    expect(rules).not.toContain('[ADDRESS_1]')
    expect(rules).toContain('Never invent a placeholder')
  })

  it('tells the model to write none when the text has none', () => {
    const rules = placeholderRules('A plain letter with no personal details.')
    expect(rules).toContain('contains no placeholders')
    expect(rules).not.toMatch(/\[[A-Z_]+_\d+\]/)
  })
})

describe('prompts do not teach the model placeholders that are not in the text', () => {
  // A document with no organisation hidden: "[ORG_1]" must never appear in any prompt.
  const prompts: Array<[string, string]> = [
    ['explain', explainPrompt(document)],
    ['quick read', quickReadPrompt(document)],
    ['follow-up', followUpPrompt(document, [{ question: 'Who referred it?', answer: 'The report says [PERSON_2].' }], 'What is the haemoglobin?')],
    ['strict combine', strictCombinePrompt('blood test or lab report', [{ question: 'Who is the report for?', answer: '[PERSON_1]' }])],
    ['strict answer', strictAnswerPrompt(document, [{ id: 'Q1', question: 'What is the haemoglobin?' }])],
    ['simplify', simplifyPrompt('A report for [PERSON_1].')],
    ['define', definePrompt('HbA1c', 'A report for [PERSON_1].')],
    ['translate', translatePrompt('A report for [PERSON_1].', 'Hindi')],
  ]

  it.each(prompts)('%s prompt has no stray ORG, ADDRESS, ID or ACCOUNT placeholder', (_name, prompt) => {
    for (const stray of ['[ORG_1]', '[ADDRESS_1]', '[ID_1]', '[ACCOUNT_1]', '[DATE_OF_BIRTH_1]']) {
      expect(prompt).not.toContain(stray)
    }
  })

  it('the explain prompt does include the placeholders that are in the document', () => {
    const prompt = explainPrompt(document)
    expect(prompt).toContain('[PERSON_1], [PERSON_2], [CONTACT_1]')
    expect(prompt).toContain('Haemoglobin 10.8')
  })

  it('the strict combine prompt takes its placeholders from the answers, not a document', () => {
    const prompt = strictCombinePrompt('loan document', [{ question: 'Who is the borrower?', answer: '[PERSON_3]' }])
    expect(prompt).toContain('The placeholders in it are: [PERSON_3].')
  })

  it('the follow-up prompt counts placeholders from the question and earlier answers too', () => {
    const prompt = followUpPrompt('Plain text.', [{ question: 'Who?', answer: 'It was [ORG_4].' }], 'Is [PERSON_9] liable?')
    expect(prompt).toContain('[ORG_4], [PERSON_9]')
  })
})
