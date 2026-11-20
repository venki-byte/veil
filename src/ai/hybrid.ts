/**
 * The hybrid inference wrapper.
 *
 * This is the ONLY file in Veil that imports `firebase/ai`. Every model call
 * in the app goes through one of the task functions exported here, which:
 *
 *   1. picks the inference mode for the task from the routing table,
 *   2. runs the leak guard on anything that could reach the cloud,
 *   3. calls Firebase AI Logic (Hybrid Inference SDK),
 *   4. records the call in the privacy ledger, including where it actually
 *      ran (`response.inferenceSource`) and the exact text sent to the cloud.
 *
 * There are no direct Prompt API calls and no direct Gemini API calls
 * anywhere in the app. Inference, the model download and the model status
 * all go through the SDK (see deviceStatus.ts for how status is derived
 * from `initializeDeviceModel()`).
 */

import {
  AIError,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type AI,
  type GenerativeModel,
  type Part,
  type SchemaRequest,
} from 'firebase/ai'
import { getConfig } from '../config/remote'
import { isModelProblem } from '../config/settings'
import { firebaseConfigured, getFirebaseApp, NotConfiguredError } from '../firebase'
import { recordLedgerEntry, type InferenceSourceName } from '../ledger/store'
import type { NanoDetector, NanoFinding } from '../privacy/detect'
import { assertNoLeak, LeakBlockedError } from '../privacy/leakGuard'
import { Registry } from '../privacy/registry'
import { createDeviceStore } from './deviceStatus'
import {
  classifyPrompt,
  definePrompt,
  detectNamesPrompt,
  detectPrompt,
  explainPrompt,
  followUpPrompt,
  LANGUAGES,
  quickReadPrompt,
  routeCheckPrompt,
  simplifyPrompt,
  strictAnswerPrompt,
  strictCombinePrompt,
  strictPlanPrompt,
  transcribePrompt,
  translatePrompt,
  type FollowUpTurn,
  type LanguageCode,
} from './prompts'
import {
  answersSchema,
  classificationSchema,
  detectionSchema,
  namesSchema,
  explanationSchema,
  parseAnswers,
  parseClassification,
  parseDetection,
  parseExplanation,
  parseJson,
  questionsSchema,
  toCloudSchema,
  type Explanation,
} from './schemas'
import {
  cleanDocumentType,
  cleanQuestions,
  DOCUMENT_TYPES,
  MAX_QUESTIONS,
  type ChunkAnswer,
  type DocumentType,
  type StrictFact,
  type StrictQuestion,
} from './strict'

export { InferenceMode }
export type { DeviceState, DeviceStatus } from './deviceStatus'
export type Mode = (typeof InferenceMode)[keyof typeof InferenceMode]

/* -------------------------------------------------------------------------- */
/* Routing table                                                              */
/* -------------------------------------------------------------------------- */

export interface Route {
  label: string
  mode: Mode
  /** The reason this task uses this mode. Shown in the UI and the README. */
  why: string
}

/**
 * Which inference mode each task uses, and why. This table is the heart of
 * the design: the device/cloud boundary is the privacy boundary.
 */
export const ROUTES = {
  transcribe: {
    label: 'Transcribe photo',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'The photo shows raw personal details, so it must never leave the device. If Gemini Nano is missing, Veil refuses rather than upload it.',
  },
  detect: {
    label: 'Detect personal details',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'Detection reads the raw document. It runs on-device only; without Gemini Nano, Veil falls back to regex and says so.',
  },
  detectNames: {
    label: 'Detect names (second pass)',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'A second, narrow on-device pass that looks only for people and organisations, which a single broad pass is most likely to miss.',
  },
  explain: {
    label: 'Explain document',
    mode: InferenceMode.ONLY_IN_CLOUD,
    why: 'A full explanation needs strong reasoning and long context. The input is already redacted and has passed the leak guard.',
  },
  quickRead: {
    label: 'Quick read',
    mode: InferenceMode.PREFER_ON_DEVICE,
    why: 'A short summary of redacted text. Local is free and instant, and it still works with no connection.',
  },
  simplify: {
    label: 'Simpler words',
    mode: InferenceMode.PREFER_ON_DEVICE,
    why: 'A light rewrite of text that is already redacted, so either path is safe; local is free and instant.',
  },
  define: {
    label: 'Explain a term',
    mode: InferenceMode.PREFER_ON_DEVICE,
    why: 'A short definition from redacted context. Small, narrow jobs are what the on-device model does well.',
  },
  translate: {
    label: 'Translate answer',
    mode: InferenceMode.PREFER_ON_DEVICE,
    why: 'Translation of redacted text. Runs locally when Gemini Nano supports the language, otherwise in the cloud.',
  },
  followUp: {
    label: 'Follow-up question',
    mode: InferenceMode.PREFER_IN_CLOUD,
    why: 'Best answer quality when online. The question is redacted first, and offline it is still answered on-device.',
  },

  // Strict mode: the cloud never sees the document, not even redacted.
  classify: {
    label: 'Strict: name the kind of document',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'Gemini Nano picks one label from a fixed list. That label is the only thing the cloud learns about the document.',
  },
  strictPlan: {
    label: 'Strict: write questions',
    mode: InferenceMode.ONLY_IN_CLOUD,
    why: 'The cloud sees only the kind of document and writes the questions to ask about it.',
  },
  strictAnswer: {
    label: 'Strict: answer on device',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'Gemini Nano answers each question from the document, chunk by chunk. The document stays on the device.',
  },
  strictCombine: {
    label: 'Strict: explain from answers',
    mode: InferenceMode.ONLY_IN_CLOUD,
    why: 'The cloud writes the explanation from short redacted answers. It never receives the document.',
  },
  followUpOnDevice: {
    label: 'Strict: follow-up question',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'After strict mode, follow-up questions are answered on-device, so the document still never leaves.',
  },
} as const satisfies Record<string, Route>

export type TaskId = keyof typeof ROUTES

/** The four modes with the tasks that use them, for the routing table UI. */
export const MODE_LABELS: Record<Mode, string> = {
  [InferenceMode.ONLY_ON_DEVICE]: 'ONLY_ON_DEVICE',
  [InferenceMode.PREFER_ON_DEVICE]: 'PREFER_ON_DEVICE',
  [InferenceMode.PREFER_IN_CLOUD]: 'PREFER_IN_CLOUD',
  [InferenceMode.ONLY_IN_CLOUD]: 'ONLY_IN_CLOUD',
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The cloud model now in use, and where that setting came from. It comes
 * from Remote Config (model_name), or VITE_CLOUD_MODEL in .env, or the
 * default in src/config/settings.ts.
 */
export function cloudModelInfo(): { model: string; fallback: string; source: string; detectionPasses: number } {
  const config = getConfig()
  return { model: config.modelName, fallback: config.fallbackModel, source: config.source, detectionPasses: config.detectionPasses }
}

/** Longest redacted text given to the on-device quick read, in characters. */
export const QUICK_READ_MAX_CHARS = 12_000

let ai: AI | null = null

function getAi(): AI {
  // Limited-use App Check tokens are recommended for AI Logic: they allow
  // replay protection, and some models refuse requests without them.
  ai ??= getAI(getFirebaseApp(), { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true })
  return ai
}

/* -------------------------------------------------------------------------- */
/* On-device model status                                                     */
/* -------------------------------------------------------------------------- */

type ExpectedIO = { type: 'text' | 'image'; languages?: string[] }

interface CreateOptions {
  expectedInputs: ExpectedIO[]
  expectedOutputs: ExpectedIO[]
}

const createOptions = (image: boolean, outputLanguage = 'en'): CreateOptions => ({
  expectedInputs: [{ type: 'text', languages: ['en'] }, ...(image ? [{ type: 'image' } as ExpectedIO] : [])],
  expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
})

/** One ONLY_ON_DEVICE model per capability, used only to prepare the model. */
const setupModels = new Map<boolean, GenerativeModel>()

function setupModel(withImage: boolean): GenerativeModel {
  let model = setupModels.get(withImage)
  if (!model) {
    model = getGenerativeModel(getAi(), {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: createOptions(withImage) },
    })
    setupModels.set(withImage, model)
  }
  return model
}

/**
 * Model status comes from the SDK's `initializeDeviceModel()` and nothing
 * else. `'LanguageModel' in globalThis` is feature detection: it reads no
 * state and calls nothing.
 */
const deviceStore = createDeviceStore({
  hasOnDeviceApi: () => 'LanguageModel' in globalThis,
  configured: firebaseConfigured,
  initialise: (withImage, onProgress) => setupModel(withImage).initializeDeviceModel(onProgress),
  describeError: (error) => describeError(error),
})

export const subscribeDeviceState = deviceStore.subscribe
export const getDeviceState = deviceStore.getState

/** Re-checks whether Gemini Nano is usable, when a re-check is safe. */
export const refreshDeviceStatus = deviceStore.refresh

/**
 * Downloads and prepares Gemini Nano through the SDK. Must be called from a
 * user action such as a button click.
 */
export const setUpDeviceModel = deviceStore.setUp

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class DeviceNotReadyError extends Error {
  constructor(message = 'Gemini Nano is not ready on this device, so this step cannot run. Nothing was sent anywhere.') {
    super(message)
    this.name = 'DeviceNotReadyError'
  }
}

export { LeakBlockedError, NotConfiguredError }

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine)

/** Turns any error from this module into a sentence a person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof LeakBlockedError) return error.message
  if (error instanceof DeviceNotReadyError) return error.message
  if (error instanceof NotConfiguredError) return error.message
  if (!isOnline()) return 'You are offline, and this step needs the cloud. It will work again when you reconnect.'
  if (error instanceof AIError) {
    const message = error.message.replace(/^AI: /, '')
    if (/app ?check|appcheck|unauthenticated|401|403/i.test(message)) {
      return `The cloud refused the request. This usually means App Check is not set up for this site yet (register the debug token in the Firebase console under Security, App Check, Apps, Manage debug tokens). Details: ${message}`
    }
    if (/429|quota|rate/i.test(message)) {
      return 'The cloud model is rate-limited right now. Wait a minute and try again.'
    }
    return message
  }
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

/* -------------------------------------------------------------------------- */
/* Core call                                                                  */
/* -------------------------------------------------------------------------- */

export interface AiResult<T> {
  value: T
  /** Where the call actually ran, as reported by the SDK. */
  source: InferenceSourceName
  mode: Mode
  durationMs: number
}

interface ImageInput {
  mimeType: string
  /** Base64-encoded image bytes. */
  data: string
}

interface Request {
  prompt: string
  /** Leak guard registry. Required for every mode that can reach the cloud. */
  registry?: Registry
  image?: ImageInput
  schema?: { id: string; value: object }
  outputLanguage?: string
}

const models = new Map<string, GenerativeModel>()

function modelFor(mode: Mode, request: Request, cloudModel: string): GenerativeModel {
  const key = [mode, cloudModel, request.schema?.id ?? 'text', request.image ? 'image' : 'text', request.outputLanguage ?? 'en'].join('|')
  let model = models.get(key)
  if (!model) {
    model = getGenerativeModel(getAi(), {
      mode,
      inCloudParams: {
        model: cloudModel,
        generationConfig: request.schema
          ? {
              responseMimeType: 'application/json',
              responseSchema: toCloudSchema(request.schema.value) as SchemaRequest,
              temperature: 0.2,
            }
          : { temperature: 0.3 },
      },
      onDeviceParams: {
        createOptions: createOptions(Boolean(request.image), request.outputLanguage),
        ...(request.schema ? { promptOptions: { responseConstraint: request.schema.value } } : {}),
      },
    })
    models.set(key, model)
  }
  return model
}

async function generate(
  mode: Mode,
  request: Request,
  cloudModel: string = getConfig().modelName,
): Promise<{ text: string; source: InferenceSourceName }> {
  const parts: Array<string | Part> = request.image
    ? [
        request.prompt,
        { type: 'inlineData', inlineData: { mimeType: request.image.mimeType, data: request.image.data } },
      ]
    : [request.prompt]

  const result = await modelFor(mode, request, cloudModel).generateContent(parts)
  const text = result.response.text()
  if (!text.trim()) throw new Error('The model returned an empty answer. Please try again.')

  const reported = result.response.inferenceSource
  const source: InferenceSourceName =
    reported === InferenceSource.ON_DEVICE
      ? 'on_device'
      : reported === InferenceSource.IN_CLOUD
        ? 'in_cloud'
        : mode === InferenceMode.ONLY_ON_DEVICE
          ? 'on_device'
          : 'in_cloud'
  return { text, source }
}

/**
 * Runs one model call for a route. Every exported task function ends here.
 */
async function run(route: Route, request: Request): Promise<AiResult<string>> {
  const { mode, label } = route
  const entryBase = {
    task: label,
    mode,
    inputChars: request.prompt.length,
    hadImage: Boolean(request.image),
  }
  const canReachCloud = mode !== InferenceMode.ONLY_ON_DEVICE

  if (canReachCloud) {
    // Structural rule: an image is raw data and is only ever handled on-device.
    if (request.image) throw new Error('Images are only processed on-device.')
    // Structural rule: nothing may be sent without passing the leak guard.
    if (!request.registry) throw new Error('Refusing to call a cloud-capable route without a leak guard registry.')
    try {
      assertNoLeak(request.prompt, request.registry)
    } catch (error) {
      if (error instanceof LeakBlockedError) {
        recordLedgerEntry({
          ...entryBase,
          source: null,
          durationMs: 0,
          status: 'blocked',
          outbound: null,
          note: `Leak guard blocked this call. Still present in the outgoing text: ${[
            ...new Set(error.leaks.map((leak) => leak.placeholder)),
          ].join(', ')}. Nothing was sent.`,
        })
      }
      throw error
    }
  }

  const device = await refreshDeviceStatus()
  if (!canReachCloud && device.status !== 'ready') {
    const error = new DeviceNotReadyError()
    recordLedgerEntry({
      ...entryBase,
      source: null,
      durationMs: 0,
      status: 'error',
      outbound: null,
      error: error.message,
    })
    throw error
  }

  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)

  const { modelName, fallbackModel } = getConfig()

  try {
    const { text, source } = await generate(mode, request, modelName)
    recordLedgerEntry({
      ...entryBase,
      source,
      durationMs: elapsed(),
      status: 'ok',
      outbound: source === 'in_cloud' ? request.prompt : null,
      model: source === 'in_cloud' ? modelName : undefined,
    })
    return { value: text, source, mode, durationMs: elapsed() }
  } catch (error) {
    // If the attempt went to the cloud and the model itself was the problem
    // (not available for this project, out of quota, overloaded), try the
    // fallback model once. The input has already passed the leak guard.
    const wentToCloud =
      mode === InferenceMode.ONLY_IN_CLOUD ||
      mode === InferenceMode.PREFER_IN_CLOUD ||
      (mode === InferenceMode.PREFER_ON_DEVICE && device.status !== 'ready')
    if (wentToCloud && modelName !== fallbackModel && isOnline() && isModelProblem(describeError(error))) {
      recordLedgerEntry({
        ...entryBase,
        source: null,
        durationMs: elapsed(),
        status: 'error',
        outbound: null,
        error: describeError(error),
        note: `Cloud model ${modelName} failed. Retrying once with ${fallbackModel}; the input is already redacted.`,
      })
      const retryStarted = performance.now()
      try {
        const { text, source } = await generate(mode, request, fallbackModel)
        const durationMs = Math.round(performance.now() - retryStarted)
        recordLedgerEntry({
          ...entryBase,
          source,
          durationMs,
          status: 'ok',
          outbound: source === 'in_cloud' ? request.prompt : null,
          model: source === 'in_cloud' ? fallbackModel : undefined,
          note: `Answered by the fallback model ${fallbackModel}.`,
        })
        return { value: text, source, mode, durationMs }
      } catch (fallbackError) {
        recordLedgerEntry({
          ...entryBase,
          source: null,
          durationMs: Math.round(performance.now() - retryStarted),
          status: 'error',
          outbound: null,
          error: describeError(fallbackError),
        })
        throw fallbackError
      }
    }

    // The SDK falls back to the cloud for PREFER_ON_DEVICE only when the
    // on-device model is unavailable, not when it fails mid-call (for
    // example on an unsupported output language). The input has already
    // passed the leak guard, so retrying in the cloud is safe.
    const deviceAttemptFailed = mode === InferenceMode.PREFER_ON_DEVICE && device.status === 'ready'
    if (deviceAttemptFailed && isOnline()) {
      recordLedgerEntry({
        ...entryBase,
        source: 'on_device',
        durationMs: elapsed(),
        status: 'error',
        outbound: null,
        error: describeError(error),
        note: 'The on-device attempt failed. Retrying in the cloud; the input is already redacted.',
      })
      const retryStarted = performance.now()
      try {
        const { text, source } = await generate(InferenceMode.ONLY_IN_CLOUD, request, modelName)
        const durationMs = Math.round(performance.now() - retryStarted)
        recordLedgerEntry({
          ...entryBase,
          source,
          durationMs,
          status: 'ok',
          outbound: request.prompt,
          model: modelName,
          note: 'Cloud fallback after the on-device attempt failed.',
        })
        return { value: text, source, mode, durationMs }
      } catch (retryError) {
        recordLedgerEntry({
          ...entryBase,
          source: null,
          durationMs: Math.round(performance.now() - retryStarted),
          status: 'error',
          outbound: null,
          error: describeError(retryError),
        })
        throw retryError
      }
    }

    recordLedgerEntry({
      ...entryBase,
      source: null,
      durationMs: elapsed(),
      status: 'error',
      outbound: null,
      error: describeError(error),
    })
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* Task functions                                                             */
/* -------------------------------------------------------------------------- */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the image.'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

/**
 * ONLY_ON_DEVICE. Reads the text out of a photographed document.
 * The image is never uploaded; if Gemini Nano is missing this throws.
 */
export async function transcribeImage(image: Blob): Promise<AiResult<string>> {
  if (image.type !== 'image/jpeg' && image.type !== 'image/png') {
    throw new Error('Only JPEG and PNG photos can be read on-device.')
  }
  const device = await refreshDeviceStatus()
  if (device.status === 'ready' && !device.image) {
    throw new DeviceNotReadyError(
      'Gemini Nano is ready, but image input is switched off in this browser. Enable chrome://flags/#prompt-api-for-gemini-nano-multimodal-input and restart Chrome. Nothing was sent anywhere.',
    )
  }
  const data = await blobToBase64(image)
  return run(ROUTES.transcribe, { prompt: transcribePrompt(), image: { mimeType: image.type, data } })
}

/**
 * ONLY_ON_DEVICE. Finds personal details in one short chunk of raw text.
 * Shaped to plug into the detection pipeline in src/privacy/detect.ts.
 */
export async function detectSensitive(chunk: string): Promise<NanoFinding[]> {
  const result = await run(ROUTES.detect, {
    prompt: detectPrompt(chunk),
    schema: { id: 'detection', value: detectionSchema },
  })
  return parseDetection(result.value)
}

/**
 * ONLY_ON_DEVICE. Second, narrow detection pass: only the names of people and
 * organisations, which the broad pass is most likely to miss.
 */
export async function detectNames(chunk: string): Promise<NanoFinding[]> {
  const result = await run(ROUTES.detectNames, {
    prompt: detectNamesPrompt(chunk),
    schema: { id: 'names', value: namesSchema },
  })
  return parseDetection(result.value)
}

/**
 * The on-device detection passes the app uses. Two passes by default; Remote
 * Config can switch to one (see src/config/remote.ts).
 */
export function detectionPasses(): NanoDetector[] {
  return getConfig().detectionPasses >= 2 ? [detectSensitive, detectNames] : [detectSensitive]
}

/** ONLY_IN_CLOUD. Structured explanation of the redacted document. */
export async function explainDocument(redactedDocument: string, registry: Registry): Promise<AiResult<Explanation>> {
  const result = await run(ROUTES.explain, {
    prompt: explainPrompt(redactedDocument),
    registry,
    schema: { id: 'explanation', value: explanationSchema },
  })
  return { ...result, value: parseExplanation(result.value) }
}

/** PREFER_ON_DEVICE. A short summary that also works offline. */
export function quickRead(redactedDocument: string, registry: Registry): Promise<AiResult<string>> {
  return run(ROUTES.quickRead, {
    prompt: quickReadPrompt(redactedDocument.slice(0, QUICK_READ_MAX_CHARS)),
    registry,
  })
}

/** PREFER_ON_DEVICE. Rewrites redacted text in simpler words. */
export function simplify(text: string, registry: Registry): Promise<AiResult<string>> {
  return run(ROUTES.simplify, { prompt: simplifyPrompt(text), registry })
}

/** PREFER_ON_DEVICE. Defines one term using redacted context. */
export function defineTerm(term: string, context: string, registry: Registry): Promise<AiResult<string>> {
  return run(ROUTES.define, { prompt: definePrompt(term, context), registry })
}

/** PREFER_ON_DEVICE. Translates redacted text; placeholders are kept. */
export function translate(text: string, language: LanguageCode, registry: Registry): Promise<AiResult<string>> {
  return run(ROUTES.translate, {
    prompt: translatePrompt(text, LANGUAGES[language].name),
    registry,
    outputLanguage: language,
  })
}

/** PREFER_IN_CLOUD. Answers a follow-up question; falls back to on-device offline. */
export function answerFollowUp(
  redactedDocument: string,
  history: FollowUpTurn[],
  redactedQuestion: string,
  registry: Registry,
): Promise<AiResult<string>> {
  return run(ROUTES.followUp, {
    prompt: followUpPrompt(redactedDocument, history, redactedQuestion),
    registry,
  })
}

/* -------------------------------------------------------------------------- */
/* Strict mode task functions                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ONLY_ON_DEVICE. Names the kind of document from a fixed list of labels.
 * The result is cleaned to one of DOCUMENT_TYPES, so no free text from the
 * document can travel to the cloud through this label.
 */
export async function classifyDocument(excerpt: string): Promise<AiResult<DocumentType>> {
  const result = await run(ROUTES.classify, {
    prompt: classifyPrompt(excerpt, DOCUMENT_TYPES),
    schema: { id: 'classification', value: classificationSchema(DOCUMENT_TYPES) },
  })
  return { ...result, value: cleanDocumentType(parseClassification(result.value)) }
}

/** ONLY_IN_CLOUD. The cloud sees only the kind of document and writes questions. */
export async function planStrictQuestions(documentType: DocumentType, registry: Registry): Promise<AiResult<StrictQuestion[]>> {
  const result = await run(ROUTES.strictPlan, {
    // cleanDocumentType again: this function cannot be handed free text.
    prompt: strictPlanPrompt(cleanDocumentType(documentType), MAX_QUESTIONS),
    registry,
    schema: { id: 'questions', value: questionsSchema },
  })
  return { ...result, value: cleanQuestions(parseJson(result.value)) }
}

/** ONLY_ON_DEVICE. Answers the cloud's questions from one chunk of the document. */
export async function answerOnDevice(chunk: string, questions: StrictQuestion[]): Promise<ChunkAnswer[]> {
  const result = await run(ROUTES.strictAnswer, {
    prompt: strictAnswerPrompt(chunk, questions),
    schema: { id: 'answers', value: answersSchema },
  })
  return parseAnswers(result.value)
}

/** ONLY_IN_CLOUD. Writes the explanation from short redacted answers only. */
export async function explainFromFacts(
  documentType: DocumentType,
  facts: StrictFact[],
  registry: Registry,
): Promise<AiResult<Explanation>> {
  const result = await run(ROUTES.strictCombine, {
    prompt: strictCombinePrompt(cleanDocumentType(documentType), facts),
    registry,
    schema: { id: 'explanation', value: explanationSchema },
  })
  return { ...result, value: parseExplanation(result.value) }
}

/** ONLY_ON_DEVICE. Follow-up after strict mode: the document stays local. */
export function answerFollowUpOnDevice(
  redactedDocument: string,
  history: FollowUpTurn[],
  redactedQuestion: string,
): Promise<AiResult<string>> {
  return run(ROUTES.followUpOnDevice, {
    prompt: followUpPrompt(redactedDocument.slice(0, QUICK_READ_MAX_CHARS), history, redactedQuestion),
  })
}

/* -------------------------------------------------------------------------- */
/* Routing check (diagnostics page)                                           */
/* -------------------------------------------------------------------------- */

/** Runs one harmless fixed prompt in the given mode, to verify routing. */
export function runRouteCheck(mode: Mode): Promise<AiResult<string>> {
  return run(
    { label: `Routing check (${MODE_LABELS[mode]})`, mode, why: 'Diagnostics' },
    { prompt: routeCheckPrompt(), registry: new Registry() },
  )
}

/**
 * Demonstrates the leak guard: tries to send text that still contains a
 * registered (invented) value to the cloud. Always throws LeakBlockedError;
 * the attempt appears in the ledger as blocked.
 */
export async function runLeakGuardDemo(): Promise<never> {
  const registry = new Registry()
  registry.add('Meenakshi Raghavan', 'PERSON', 'manual')
  registry.add('98450 12367', 'CONTACT', 'manual')
  await run(
    { label: 'Leak guard demonstration', mode: InferenceMode.ONLY_IN_CLOUD, why: 'Diagnostics' },
    { prompt: 'Summarise: [PERSON_1] can be reached on 9845012367 about her report.', registry },
  )
  throw new Error('The leak guard did not block the planted value.')
}
