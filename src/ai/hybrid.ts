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
 * There are no direct Prompt API prompts and no direct Gemini API calls
 * anywhere in the app. The one direct touch of the browser's `LanguageModel`
 * object is a read-only `availability()` check, used to show model status
 * and to decide when a "Set up" click is needed; the SDK has no public call
 * for that. All inference still goes through the SDK.
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
} from 'firebase/ai'
import { getFirebaseApp, NotConfiguredError } from '../firebase'
import { recordLedgerEntry, type InferenceSourceName } from '../ledger/store'
import type { NanoFinding } from '../privacy/detect'
import { assertNoLeak, LeakBlockedError } from '../privacy/leakGuard'
import { Registry } from '../privacy/registry'
import {
  definePrompt,
  detectPrompt,
  explainPrompt,
  followUpPrompt,
  LANGUAGES,
  quickReadPrompt,
  routeCheckPrompt,
  simplifyPrompt,
  transcribePrompt,
  translatePrompt,
  type FollowUpTurn,
  type LanguageCode,
} from './prompts'
import {
  detectionSchema,
  explanationSchema,
  parseDetection,
  parseExplanation,
  type Explanation,
} from './schemas'

export { InferenceMode }
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
 * Cloud model for explanations and follow-ups. The default matches the
 * Hybrid Inference SDK's own default cloud model; override with
 * VITE_CLOUD_MODEL in .env to use a stronger model.
 */
export const CLOUD_MODEL = (import.meta.env.VITE_CLOUD_MODEL as string | undefined) || 'gemini-3.5-flash-lite'

/** Longest redacted text given to the on-device quick read, in characters. */
export const QUICK_READ_MAX_CHARS = 12_000

let ai: AI | null = null

function getAi(): AI {
  ai ??= getAI(getFirebaseApp(), { backend: new GoogleAIBackend() })
  return ai
}

/* -------------------------------------------------------------------------- */
/* On-device model status                                                     */
/* -------------------------------------------------------------------------- */

export type DeviceStatus = 'checking' | 'unavailable' | 'downloadable' | 'downloading' | 'ready'

export interface DeviceState {
  status: DeviceStatus
  /** Whether on-device image input (photo transcription) is usable. */
  image: boolean
  /** Download progress from 0 to 1 while downloading, otherwise null. */
  progress: number | null
  error: string | null
}

type ExpectedIO = { type: 'text' | 'image'; languages?: string[] }

interface CreateOptions {
  expectedInputs: ExpectedIO[]
  expectedOutputs: ExpectedIO[]
}

const createOptions = (image: boolean, outputLanguage = 'en'): CreateOptions => ({
  expectedInputs: [{ type: 'text', languages: ['en'] }, ...(image ? [{ type: 'image' } as ExpectedIO] : [])],
  expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
})

let deviceState: DeviceState = { status: 'checking', image: false, progress: null, error: null }
const deviceListeners = new Set<() => void>()
let settingUp = false

function setDeviceState(patch: Partial<DeviceState>) {
  deviceState = { ...deviceState, ...patch }
  for (const listener of deviceListeners) listener()
}

export function subscribeDeviceState(listener: () => void): () => void {
  deviceListeners.add(listener)
  return () => deviceListeners.delete(listener)
}

export function getDeviceState(): DeviceState {
  return deviceState
}

/** Read-only availability check. This does not run or download a model. */
async function probe(options: CreateOptions): Promise<string> {
  const languageModel = (
    globalThis as { LanguageModel?: { availability?: (options: CreateOptions) => Promise<string> } }
  ).LanguageModel
  if (!languageModel?.availability) return 'unavailable'
  try {
    return await languageModel.availability(options)
  } catch {
    return 'unavailable'
  }
}

/** Re-checks whether Gemini Nano is usable in this browser. */
export async function refreshDeviceStatus(): Promise<DeviceState> {
  const [text, image] = await Promise.all([probe(createOptions(false)), probe(createOptions(true))])
  if (settingUp && text !== 'available') return deviceState

  const status: DeviceStatus =
    text === 'available'
      ? 'ready'
      : text === 'downloading'
        ? 'downloading'
        : text === 'downloadable'
          ? 'downloadable'
          : 'unavailable'

  setDeviceState({
    status,
    image: status === 'ready' && image === 'available',
    progress: status === 'downloading' ? deviceState.progress : null,
  })
  return deviceState
}

/**
 * Downloads and prepares Gemini Nano. Must be called from a user action such
 * as a button click; the browser refuses to start the download otherwise.
 * The first download can take several minutes.
 */
export async function setUpDeviceModel(): Promise<DeviceState> {
  if (settingUp) return deviceState
  settingUp = true
  setDeviceState({ status: 'downloading', progress: 0, error: null })

  try {
    // Ask for image input too when this browser offers it, so one download
    // covers both text and photo tasks.
    const wantsImage = (await probe(createOptions(true))) !== 'unavailable'
    const model = getGenerativeModel(getAi(), {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: createOptions(wantsImage) },
    })
    await model.initializeDeviceModel((progress) => setDeviceState({ progress }))
  } catch (error) {
    settingUp = false
    await refreshDeviceStatus()
    setDeviceState({ error: describeError(error) })
    return deviceState
  }

  settingUp = false
  return refreshDeviceStatus()
}

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
      return `The cloud refused the request. This usually means App Check is not set up for this site yet (register the debug token in the Firebase console). Details: ${message}`
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

function modelFor(mode: Mode, request: Request): GenerativeModel {
  const key = [mode, request.schema?.id ?? 'text', request.image ? 'image' : 'text', request.outputLanguage ?? 'en'].join('|')
  let model = models.get(key)
  if (!model) {
    model = getGenerativeModel(getAi(), {
      mode,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: request.schema
          ? { responseMimeType: 'application/json', responseJsonSchema: { ...request.schema.value }, temperature: 0.2 }
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

async function generate(mode: Mode, request: Request): Promise<{ text: string; source: InferenceSourceName }> {
  const parts: Array<string | Part> = request.image
    ? [
        { type: 'inlineData', inlineData: { mimeType: request.image.mimeType, data: request.image.data } },
        request.prompt,
      ]
    : [request.prompt]

  const result = await modelFor(mode, request).generateContent(parts)
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

  try {
    const { text, source } = await generate(mode, request)
    recordLedgerEntry({
      ...entryBase,
      source,
      durationMs: elapsed(),
      status: 'ok',
      outbound: source === 'in_cloud' ? request.prompt : null,
    })
    return { value: text, source, mode, durationMs: elapsed() }
  } catch (error) {
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
        const { text, source } = await generate(InferenceMode.ONLY_IN_CLOUD, request)
        const durationMs = Math.round(performance.now() - retryStarted)
        recordLedgerEntry({
          ...entryBase,
          source,
          durationMs,
          status: 'ok',
          outbound: request.prompt,
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
