/**
 * Every prompt Veil sends to a model.
 *
 * Instructions are written into the prompt text itself rather than a system
 * instruction, for two reasons: the on-device path ignores system
 * instructions, and it means the privacy ledger can show the complete,
 * exact text of every cloud request.
 *
 * Veil explains documents. It does not advise. The prompts avoid diagnostic
 * and directive wording on purpose.
 */

const PLACEHOLDER_RULES = `The text has had personal details replaced with placeholders such as [PERSON_1], [ORG_1], [ADDRESS_1], [ID_1], [ACCOUNT_1], [CONTACT_1] and [DATE_OF_BIRTH_1].
- When you refer to those people or things, use the placeholders exactly as written, including the square brackets.
- Never guess, invent or ask for the hidden values.`

const EXPLAIN_NOT_ADVISE = `- Explain what the document says. Do not give medical, legal or financial advice, do not diagnose, and do not tell the reader what decision to make.
- Use only what is in the document. If something is unclear or missing, say so.
- Write for a reader with no specialist knowledge: short sentences and everyday words.
- Plain text only. No Markdown, no bullet symbols, no headings.`

export const LANGUAGES = {
  hi: { name: 'Hindi', native: 'हिन्दी' },
  ta: { name: 'Tamil', native: 'தமிழ்' },
} as const

export type LanguageCode = keyof typeof LANGUAGES

/** On-device: transcribe a photographed document. The image never leaves the device. */
export function transcribePrompt(): string {
  return `Transcribe all the text in this image of a document.
- Copy the text exactly as written, including names, numbers and dates.
- Keep the line breaks and the reading order. Put each table row on its own line.
- Do not summarise, explain, translate or add anything.
- If a word cannot be read, write [unreadable] in its place.
Output only the transcribed text.`
}

/** On-device: find personal details in one short chunk. */
export function detectPrompt(chunk: string): string {
  return `You find personal details in an excerpt from a private document, so they can be hidden before the document is shared.

List every piece of text in the excerpt that could identify a specific person, household or organisation. Copy each one exactly as it appears in the excerpt.

Types:
- PERSON: names of people, including doctors, witnesses, officials and relatives
- ORG: names of specific companies, banks, hospitals, labs, employers, housing societies
- ADDRESS: street addresses, flat or plot numbers, localities, PIN or ZIP codes
- ID: government, patient, customer, employee, tax, registration or reference numbers
- DATE_OF_BIRTH: a date of birth
- CONTACT: phone numbers, email addresses, websites
- ACCOUNT: bank account, card, loan or policy numbers
- OTHER: any other detail that points to a specific person, such as a vehicle number or signature name

Do not list: amounts of money, percentages, test results, measurements, durations, dates that are not a date of birth, job titles, field labels, or general words.

If there are none, return an empty list.

Excerpt:
"""
${chunk}
"""`
}

/** In-cloud: the full structured explanation of the redacted document. */
export function explainPrompt(redactedDocument: string): string {
  return `You are Veil, a careful assistant that explains personal paperwork in plain language.

${PLACEHOLDER_RULES}
${EXPLAIN_NOT_ADVISE}

Return JSON with these fields:
- documentType: a short name for the kind of document, for example "Blood test report" or "Home loan sanction letter".
- summary: 3 to 5 sentences on what this document is and what it means for the reader.
- keyTerms: up to 8 terms from the document that a reader may not know, each with a one-sentence meaning in everyday words.
- thingsToWatch: up to 6 points that deserve the reader's attention, such as results outside the reference range, unusual or one-sided clauses, penalties, conditions and obligations. Each has a short title and a one or two sentence detail that says what the document states.
- deadlinesAndAmounts: every deadline, date, amount, rate, fee or out-of-range result that matters. Each has a label, the value exactly as written in the document, and a short note.
- questionsToAsk: 3 to 5 questions the reader could ask the doctor, landlord, lender or official who issued the document.

Document:
"""
${redactedDocument}
"""`
}

/** Prefer on-device: a short summary that also works with no connection. */
export function quickReadPrompt(redactedDocument: string): string {
  return `Give a quick read of the document below.

${PLACEHOLDER_RULES}
${EXPLAIN_NOT_ADVISE}

Write 4 to 6 short sentences: what kind of document this is, the most important facts, numbers and dates in it, and anything the reader should look at closely.

Document:
"""
${redactedDocument}
"""`
}

/** Prefer on-device: rewrite an explanation in simpler words. */
export function simplifyPrompt(text: string): string {
  return `Rewrite the text below in simpler words, for a reader who finds official language hard.
- Use short sentences and common words. Keep every fact, number and date.
- Keep placeholders such as [PERSON_1] or [ORG_1] exactly as written.
- Do not add advice or new information. Plain text only.

Text:
"""
${text}
"""`
}

/** Prefer on-device: define one term in context. */
export function definePrompt(term: string, context: string): string {
  return `Explain the term "${term}" in two or three short sentences of everyday language, as it is used in the context below.
- Say what it means in general, then what it refers to here.
- Keep placeholders such as [PERSON_1] exactly as written.
- Do not give advice. Plain text only.

Context:
"""
${context}
"""`
}

/** Prefer on-device: translate an explanation. */
export function translatePrompt(text: string, languageName: string): string {
  return `Translate the text below into ${languageName}.
- Use natural, everyday ${languageName}.
- Keep placeholders such as [PERSON_1] or [ORG_1] exactly as written, in Latin letters with the square brackets.
- Keep numbers, amounts and dates unchanged.
- Output only the translation.

Text:
"""
${text}
"""`
}

export interface FollowUpTurn {
  question: string
  answer: string
}

/** Prefer in-cloud: answer a follow-up question about the redacted document. */
export function followUpPrompt(redactedDocument: string, history: FollowUpTurn[], question: string): string {
  const earlier = history.length
    ? `Earlier questions and answers:\n${history
        .map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`)
        .join('\n')}\n\n`
    : ''

  return `You are Veil, a careful assistant that answers questions about a personal document in plain language.

${PLACEHOLDER_RULES}
${EXPLAIN_NOT_ADVISE}
- Answer in 2 to 5 sentences. If the document does not answer the question, say that it does not.

Document:
"""
${redactedDocument}
"""

${earlier}Question: ${question}`
}

/** Harmless fixed prompt used by the routing check page. */
export function routeCheckPrompt(): string {
  return 'Reply with one short sentence that says hello and names one colour.'
}
