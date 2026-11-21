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

const PLACEHOLDER_PATTERN = /\[[A-Z_]+_\d+\]/g

/** The distinct placeholders, such as [PERSON_1], that appear in `source`, in order. */
export function placeholdersIn(source: string): string[] {
  return [...new Set(source.match(PLACEHOLDER_PATTERN) ?? [])]
}

/**
 * Rules about placeholders. They list only the placeholders that really
 * appear in `source`: a model that is shown a placeholder it never saw in the
 * text tends to copy it into its answer, where it can never be restored.
 */
export function placeholderRules(source: string): string {
  const present = placeholdersIn(source)
  const which = present.length
    ? `The text has had personal details replaced with placeholders. The placeholders in it are: ${present.join(', ')}.
- When you refer to those people or things, use these placeholders exactly as written, including the square brackets.
- Use only the placeholders in that list. Never invent a placeholder, and never write one for something that is named in the text.`
    : `The text contains no placeholders. Do not write any placeholder or any other text in square brackets.`
  return `${which}
- Never guess, invent or ask for hidden values.`
}

const EXPLAIN_NOT_ADVISE = `- Explain what the document says. Do not give medical, legal or financial advice, do not diagnose, and do not tell the reader what decision to make.
- Use only what is in the document. If something is unclear or missing, say so.
- Write for a reader with no specialist knowledge: short sentences and everyday words.
- Plain text only. No Markdown, no bullet symbols, no headings.`

const EXPLANATION_FIELDS = `Return JSON with these fields:
- documentType: a short name for the kind of document, for example "Blood test report" or "Home loan sanction letter".
- summary: 3 to 5 sentences on what this document is and what it means for the reader.
- keyTerms: up to 8 terms from the document that a reader may not know, each with a one-sentence meaning in everyday words.
- thingsToWatch: up to 6 points that deserve the reader's attention, such as results outside the reference range, unusual or one-sided clauses, penalties, conditions and obligations. Each has a short title and a one or two sentence detail that says what the document states.
- deadlinesAndAmounts: every deadline, date, amount, rate, fee or out-of-range result that matters. Each has a label, the value exactly as written in the document, and a short note.
- questionsToAsk: 3 to 5 questions the reader could ask the doctor, landlord, lender or official who issued the document.`

/**
 * Languages the answer can be translated into. Gemini Nano supports only a
 * few output languages (in testing: de, en, es, fr, ja), so these run in the
 * cloud on already-redacted text unless the browser's model supports them;
 * the badge shows which. The first two are listed first in the menu.
 */
export const LANGUAGES = {
  hi: { name: 'Hindi', native: 'हिन्दी' },
  ta: { name: 'Tamil', native: 'தமிழ்' },
  te: { name: 'Telugu', native: 'తెలుగు' },
  bn: { name: 'Bengali', native: 'বাংলা' },
  mr: { name: 'Marathi', native: 'मराठी' },
  kn: { name: 'Kannada', native: 'ಕನ್ನಡ' },
  ml: { name: 'Malayalam', native: 'മലയാളം' },
  gu: { name: 'Gujarati', native: 'ગુજરાતી' },
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

/**
 * On-device, second detection pass: one narrow job. Small models miss names
 * that sit inside sentences ("reporting to Varun Tewari") when they are also
 * looking for numbers, dates and addresses, so this pass asks only for names.
 */
export function detectNamesPrompt(chunk: string): string {
  return `Read the excerpt below and list the name of every person and every named organisation in it.

- People: everyone named anywhere, including inside sentences, greetings, signatures, and after words such as "to", "from", "by", "with", "contact", "reporting to", "son of", "wife", "daughter", "witness" or "Dr.". Give the name as written, without titles such as Mr., Mrs., Ms. or Dr.
- Organisations: named companies, banks, hospitals, clinics, laboratories, schools, employers, courts, insurers and housing societies.
- Copy each name exactly as it appears. Use the type PERSON or ORG.
- Do not list job titles, roles or generic words such as "the tenant", "the bank" or "the doctor".

If there are none, return an empty list.

Excerpt:
"""
${chunk}
"""`
}

/** In-cloud: the full structured explanation of the redacted document. */
export function explainPrompt(redactedDocument: string): string {
  return `You are Veil, a careful assistant that explains personal paperwork in plain language.

${placeholderRules(redactedDocument)}
${EXPLAIN_NOT_ADVISE}

${EXPLANATION_FIELDS}

Document:
"""
${redactedDocument}
"""`
}

/* ------------------------------- Strict mode ------------------------------ */

/** On-device: pick the kind of document from a fixed list of labels. */
export function classifyPrompt(excerpt: string, labels: readonly string[]): string {
  return `Choose the one label that best describes what kind of document this excerpt comes from.

Labels:
${labels.map((label) => `- ${label}`).join('\n')}

Answer with exactly one of the labels. If none fits, answer "other document".

Excerpt:
"""
${excerpt}
"""`
}

/** In-cloud: sees only the kind of document, and writes questions to ask about it. */
export function strictPlanPrompt(documentType: string, maxQuestions: number): string {
  return `You are helping to explain a personal document that you are not allowed to see. All you know is its kind: "${documentType}".

A small model on the reader's device can read the document. Write the questions it should answer, so that you can later explain the document in plain language.

Rules:
- Write 6 to ${maxQuestions} questions.
- Each question asks for one specific fact that can be answered in a few words or one short sentence from the document: an amount, a date, a duration, a rate, a result with its reference range, a condition, a penalty.
- Together the questions should cover: what the document is for, the key amounts and dates, deadlines, obligations and conditions, penalties or risks, anything marked abnormal or unusual, and what the reader is asked to do next.
- Do not ask for names, addresses, phone numbers, ID numbers or account numbers.
- Plain text, one question per item.

Return JSON with one field, questions, a list of strings.`
}

/** On-device: answer the cloud's questions from one chunk of the document. */
export function strictAnswerPrompt(chunk: string, questions: Array<{ id: string; question: string }>): string {
  return `Answer each question using only the excerpt below.
- Keep each answer short: a few words or one short sentence of at most 30 words.
- Copy amounts, dates and numbers exactly as written.
- Placeholders in square brackets, such as the ones in the excerpt, must be kept exactly as written. Never add a new one.
- If the excerpt does not contain the answer, answer exactly: NOT FOUND
- Give one answer for every question id.

Questions:
${questions.map((item) => `${item.id}: ${item.question}`).join('\n')}

Excerpt:
"""
${chunk}
"""`
}

/** In-cloud: write the explanation from short answers, without the document. */
export function strictCombinePrompt(documentType: string, facts: Array<{ question: string; answer: string }>): string {
  return `You are Veil, a careful assistant that explains personal paperwork in plain language.

You have not seen the document, and you will not see it. A model on the reader's device read it and answered questions about it. The document is a "${documentType}". The answers are below.

${placeholderRules(facts.map((fact) => `${fact.question} ${fact.answer}`).join('\n'))}
${EXPLAIN_NOT_ADVISE}
- Base everything on the answers below. Do not invent facts. If the answers leave something out, say that it could not be determined rather than guessing.

${EXPLANATION_FIELDS}

Answers from the reader's device:
${facts.map((fact) => `Q: ${fact.question}\nA: ${fact.answer}`).join('\n\n')}`
}

/** Prefer on-device: a short summary that also works with no connection. */
export function quickReadPrompt(redactedDocument: string): string {
  return `Give a quick read of the document below.

${placeholderRules(redactedDocument)}
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
- Keep any placeholders in square brackets exactly as written. Never write square brackets for anything else; if a value is not given, say so in words.
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
- Keep any placeholders in square brackets exactly as written. Never write square brackets for anything else; if a value is not given, say so in words.
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
- Keep any placeholders in square brackets exactly as written, in Latin letters with the square brackets. Never write square brackets for anything else.
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

${placeholderRules(`${redactedDocument}\n${history.map((turn) => `${turn.question} ${turn.answer}`).join('\n')}\n${question}`)}
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
