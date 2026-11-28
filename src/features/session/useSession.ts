/**
 * The state of one document session: load, detect, review, explain, ask.
 *
 * All model calls go through src/ai/hybrid.ts. This hook only decides what
 * to call and when, and keeps the results. Every answer is stored in its
 * placeholder form; real values are put back only at render time, locally.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  answerFollowUp,
  answerFollowUpOnDevice,
  answerOnDevice,
  classifyDocument,
  defineTerm,
  describeError,
  detectionPasses,
  explainDocument,
  explainFromFacts,
  getDeviceState,
  LeakBlockedError,
  planStrictQuestions,
  quickRead,
  QUICK_READ_MAX_CHARS,
  refreshDeviceStatus,
  ROUTES,
  simplify,
  transcribeBands,
  translate,
  type AiResult,
} from '../../ai/hybrid'
import type { LanguageCode } from '../../ai/prompts'
import type { Explanation } from '../../ai/schemas'
import { runStrict, type DocumentType, type StrictFact, type StrictStep } from '../../ai/strict'
import { firebaseConfigured } from '../../firebase'
import type { InferenceSourceName } from '../../ledger/store'
import { detectDocument } from '../../privacy/detect'
import { findLeaks, type Leak } from '../../privacy/leakGuard'
import { detectWithRegex } from '../../privacy/regex'
import { Registry } from '../../privacy/registry'
import type { SensitiveType } from '../../privacy/types'
import {
  extractPdfText,
  kindOfFile,
  MAX_DOCUMENT_CHARS,
  normaliseText,
  prepareImage,
  type LoadedDocument,
} from '../ingest/readFile'
import { SAMPLES } from '../ingest/samples'

export type Stage = 'empty' | 'reading' | 'detecting' | 'review' | 'result'

export interface DetectionInfo {
  running: boolean
  done: number
  total: number
  /** Whether Gemini Nano took part in detection. */
  nanoUsed: boolean
  nanoFailures: number
}

export interface TextResult {
  text: string
  source: InferenceSourceName
  durationMs: number
}

export interface FollowUp {
  id: number
  question: string
  /** The question as it was sent, with personal details replaced. */
  redactedQuestion: string
  status: 'pending' | 'done' | 'error'
  answer?: TextResult
  error?: string
}

/** What the cloud was given in place of the document, in strict mode. */
export interface StrictTrail {
  documentType: DocumentType
  facts: StrictFact[]
  failedChunks: number
}

const toTextResult = (result: AiResult<string>): TextResult => ({
  text: result.value.trim(),
  source: result.source,
  durationMs: result.durationMs,
})

/** The explanation as one block of text, for the light tasks. */
function explanationAsText(explanation: Explanation): string {
  return [explanation.summary, ...explanation.thingsToWatch.map((item) => `${item.title}: ${item.detail}`)].join('\n')
}

export function useSession() {
  const [stage, setStage] = useState<Stage>('empty')
  const [doc, setDoc] = useState<LoadedDocument | null>(null)
  const [readingLabel, setReadingLabel] = useState('')
  const [registry, setRegistry] = useState(() => new Registry())
  const [version, bump] = useReducer((count: number) => count + 1, 0)
  const [detection, setDetection] = useState<DetectionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leaks, setLeaks] = useState<Leak[] | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  /** Text streamed so far for each running task, keyed like `busy`. Placeholders are still in it. */
  const [streams, setStreams] = useState<Record<string, string>>({})

  const [explanation, setExplanation] = useState<AiResult<Explanation> | null>(null)
  const [quick, setQuick] = useState<TextResult | null>(null)
  const [strictStep, setStrictStep] = useState<StrictStep | null>(null)
  const [strictTrail, setStrictTrail] = useState<StrictTrail | null>(null)
  const [simple, setSimple] = useState<TextResult | null>(null)
  const [translations, setTranslations] = useState<Partial<Record<LanguageCode, TextResult>>>({})
  const [terms, setTerms] = useState<Record<string, TextResult>>({})
  const [toolError, setToolError] = useState<string | null>(null)
  const [followUps, setFollowUps] = useState<FollowUp[]>([])

  /** Incremented whenever a new document replaces the old one. */
  const runId = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const imageUrl = useRef<string | null>(null)
  const nextFollowUpId = useRef(1)

  const start = (key: string) => setBusy((current) => [...current, key])
  const finish = (key: string) => {
    setBusy((current) => current.filter((item) => item !== key))
    setStreams((current) => Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)))
  }
  const streamTo = (key: string) => (soFar: string) => setStreams((current) => ({ ...current, [key]: soFar }))

  const clearResults = useCallback(() => {
    setExplanation(null)
    setStrictStep(null)
    setStrictTrail(null)
    setQuick(null)
    setSimple(null)
    setTranslations({})
    setTerms({})
    setToolError(null)
    setFollowUps([])
    setLeaks(null)
    setError(null)
    setBusy([])
    setStreams({})
  }, [])

  const releaseImage = () => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
    imageUrl.current = null
  }

  useEffect(
    () => () => {
      abort.current?.abort()
      releaseImage()
    },
    [],
  )

  /** Step 2 and 3 of the pipeline: detect locally, then build the registry. */
  const loadDocument = useCallback(
    async (loaded: LoadedDocument) => {
      const text = normaliseText(loaded.text)
      if (!text) {
        setError('That document has no readable text.')
        setStage('empty')
        return
      }
      if (text.length > MAX_DOCUMENT_CHARS) {
        setError(
          `That document is too long (${text.length.toLocaleString()} characters). Veil handles up to ${MAX_DOCUMENT_CHARS.toLocaleString()}; try the part you need explained.`,
        )
        setStage('empty')
        return
      }

      runId.current += 1
      const run = runId.current
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller

      clearResults()
      const fresh = new Registry()
      // Pattern matches are instant, so the user sees redaction straight away
      // while Gemini Nano reads the document chunk by chunk.
      fresh.addSpans(detectWithRegex(text))
      setRegistry(fresh)
      setDoc({ ...loaded, text })
      setStage('detecting')
      // Marked as running from the first moment, so nothing can be sent
      // while detection is still in progress.
      setDetection({ running: true, done: 0, total: 0, nanoUsed: false, nanoFailures: 0 })

      // Re-check the model rather than trusting a status that may still be
      // "checking" when a document is opened straight after page load.
      const device = firebaseConfigured ? await refreshDeviceStatus() : getDeviceState()
      if (run !== runId.current) return
      const useNano = firebaseConfigured && device.status === 'ready'
      setDetection({ running: true, done: 0, total: 0, nanoUsed: useNano, nanoFailures: 0 })

      const result = await detectDocument(text, {
        nano: useNano ? detectionPasses() : undefined,
        signal: controller.signal,
        onProgress: (done, total) => {
          if (run === runId.current) setDetection((current) => (current ? { ...current, done, total } : current))
        },
      })
      if (run !== runId.current) return

      fresh.addSpans(result.spans)
      bump()
      setDetection({
        running: false,
        done: result.nanoChunks,
        total: result.nanoChunks,
        nanoUsed: useNano && result.nanoFailures < Math.max(result.nanoCalls, 1),
        nanoFailures: result.nanoFailures,
      })
      setStage('review')
    },
    [clearResults],
  )

  /** Step 1 of the pipeline: get plain text out of a file, locally. */
  const loadFile = useCallback(
    async (file: File) => {
      const kind = kindOfFile(file)
      setError(null)
      if (!kind) {
        setError('Veil can open PDF files, text files, and JPEG or PNG photos.')
        return
      }

      runId.current += 1
      const run = runId.current
      setStage('reading')

      try {
        if (kind === 'pdf') {
          setReadingLabel('Reading the PDF in this browser')
          const text = await extractPdfText(file)
          if (run !== runId.current) return
          if (!text.trim()) {
            throw new Error(
              'This PDF has no text layer (it is probably a scan). Take a screenshot or photo of the page and open that instead.',
            )
          }
          await loadDocument({ text, name: file.name, kind })
        } else if (kind === 'photo') {
          setReadingLabel('Gemini Nano is reading the photo on this device')
          const bands = await prepareImage(file)
          const result = await transcribeBands(bands, (index, total) => {
            if (run === runId.current && total > 1) {
              setReadingLabel(`Gemini Nano is reading the photo on this device (part ${index} of ${total})`)
            }
          })
          if (run !== runId.current) return
          releaseImage()
          // The thumbnail is the photo as it was opened, not the contrast-adjusted copy.
          imageUrl.current = URL.createObjectURL(file)
          await loadDocument({
            text: result.value,
            name: file.name,
            kind,
            imageUrl: imageUrl.current,
            transcriptionMs: result.durationMs,
          })
        } else {
          setReadingLabel('Reading the file')
          await loadDocument({ text: await file.text(), name: file.name, kind })
        }
      } catch (caught) {
        if (run !== runId.current) return
        setError(describeError(caught))
        setStage('empty')
      }
    },
    [loadDocument],
  )

  const loadText = useCallback(
    (text: string) => loadDocument({ text, name: 'Pasted text', kind: 'paste' }),
    [loadDocument],
  )

  const loadSample = useCallback(
    (id: string) => {
      const sample = SAMPLES.find((candidate) => candidate.id === id)
      if (sample) void loadDocument({ text: sample.text, name: `Sample: ${sample.title}`, kind: 'sample' })
    },
    [loadDocument],
  )

  const reset = useCallback(() => {
    runId.current += 1
    abort.current?.abort()
    releaseImage()
    clearResults()
    setDoc(null)
    setDetection(null)
    setRegistry(new Registry())
    setStage('empty')
  }, [clearResults])

  /* ------------------------------ Review step ----------------------------- */

  const setEntryEnabled = useCallback(
    (id: string, enabled: boolean) => {
      registry.setEnabled(id, enabled)
      setLeaks(null)
      bump()
    },
    [registry],
  )

  /** Hides a word or phrase chosen by the user, everywhere it appears. */
  const addManual = useCallback(
    (value: string, type: SensitiveType): boolean => {
      const entry = registry.add(value, type, 'manual')
      if (!entry) return false
      registry.setEnabled(entry.id, true)
      setLeaks(null)
      bump()
      return true
    },
    [registry],
  )

  /** Exactly what would be sent: the document with placeholders. */
  const redacted = useMemo(
    () => (doc ? registry.redact(doc.text) : ''),
    // `version` changes whenever the registry is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, registry, version],
  )

  /** Live leak guard result for the review panel. The real check runs again inside hybrid.ts. */
  const liveLeaks = useMemo(
    () => (doc ? findLeaks(redacted, registry) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, redacted, registry, version],
  )

  /* --------------------------- Explain and tools -------------------------- */

  const explain = useCallback(async () => {
    if (!doc) return
    const run = runId.current
    setError(null)
    setLeaks(null)
    start('explain')
    try {
      const result = await explainDocument(registry.redact(doc.text), registry)
      if (run !== runId.current) return
      setExplanation(result)
      setStrictTrail(null)
      setSimple(null)
      setTranslations({})
      setStage('result')
    } catch (caught) {
      if (run !== runId.current) return
      if (caught instanceof LeakBlockedError) setLeaks(caught.leaks)
      setError(describeError(caught))
    } finally {
      finish('explain')
    }
  }, [doc, registry])

  /**
   * Strict mode: the cloud never receives the document. It sees the kind of
   * document, writes questions, and later sees Gemini Nano's short answers.
   */
  const runStrictMode = useCallback(async () => {
    if (!doc) return
    const run = runId.current
    const started = performance.now()
    setError(null)
    setLeaks(null)
    start('strict')
    try {
      const outcome = await runStrict(registry.redact(doc.text), {
        classify: async (excerpt) => (await classifyDocument(excerpt)).value,
        plan: async (documentType) => (await planStrictQuestions(documentType, registry)).value,
        answer: answerOnDevice,
        combine: async (documentType, facts) => (await explainFromFacts(documentType, facts, registry)).value,
        redact: (text) => registry.redact(text),
        onStep: (step) => {
          if (run === runId.current) setStrictStep(step)
        },
      })
      if (run !== runId.current) return
      setExplanation({
        value: outcome.explanation,
        source: 'in_cloud',
        mode: ROUTES.strictCombine.mode,
        durationMs: Math.round(performance.now() - started),
      })
      setStrictTrail({ documentType: outcome.documentType, facts: outcome.facts, failedChunks: outcome.failedChunks })
      setSimple(null)
      setTranslations({})
      setStage('result')
    } catch (caught) {
      if (run !== runId.current) return
      if (caught instanceof LeakBlockedError) setLeaks(caught.leaks)
      setError(describeError(caught))
    } finally {
      finish('strict')
      if (run === runId.current) setStrictStep(null)
    }
  }, [doc, registry])

  const runQuickRead = useCallback(async () => {
    if (!doc) return
    const run = runId.current
    setError(null)
    setLeaks(null)
    start('quick')
    try {
      const result = await quickRead(registry.redact(doc.text), registry, streamTo('quick'))
      if (run !== runId.current) return
      setQuick(toTextResult(result))
      setStage('result')
    } catch (caught) {
      if (run !== runId.current) return
      if (caught instanceof LeakBlockedError) setLeaks(caught.leaks)
      setError(describeError(caught))
    } finally {
      finish('quick')
    }
  }, [doc, registry])

  /** The current answer in placeholder form, for the light tasks. */
  const answerText = explanation ? explanationAsText(explanation.value) : (quick?.text ?? '')

  const runTool = useCallback(
    async (key: string, task: (onText: (soFar: string) => void) => Promise<AiResult<string>>, store: (result: TextResult) => void) => {
      const run = runId.current
      setToolError(null)
      start(key)
      try {
        const result = await task(streamTo(key))
        if (run === runId.current) store(toTextResult(result))
      } catch (caught) {
        if (run === runId.current) setToolError(describeError(caught))
      } finally {
        finish(key)
      }
    },
    [],
  )

  const runSimplify = useCallback(
    () => runTool('simplify', (onText) => simplify(answerText, registry, onText), setSimple),
    [answerText, registry, runTool],
  )

  const runTranslate = useCallback(
    (language: LanguageCode) =>
      runTool(
        `translate:${language}`,
        (onText) => translate(simple?.text ?? answerText, language, registry, onText),
        (result) => setTranslations((current) => ({ ...current, [language]: result })),
      ),
    [answerText, registry, runTool, simple],
  )

  const runDefine = useCallback(
    (term: string) => {
      const cleanTerm = registry.redact(term.trim()).slice(0, 80)
      if (!cleanTerm) return Promise.resolve()
      const known = explanation?.value.keyTerms.find((item) => item.term.toLowerCase() === cleanTerm.toLowerCase())
      const context = [known ? `${known.term}: ${known.meaning}` : '', answerText].filter(Boolean).join('\n')
      return runTool(
        `define:${cleanTerm}`,
        (onText) => defineTerm(cleanTerm, context, registry, onText),
        (result) => setTerms((current) => ({ ...current, [cleanTerm]: result })),
      )
    },
    [answerText, explanation, registry, runTool],
  )

  /** Step 8 of the pipeline: redact the question with the same registry, then ask. */
  const ask = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim()
      if (!doc || !question) return
      const run = runId.current

      // The question may contain new personal details. Shaped ones (a new
      // phone number, say) are registered before anything is sent.
      for (const span of detectWithRegex(question)) {
        if (span.type !== 'DATE') registry.add(span.text, span.type, span.source)
      }
      bump()
      const redactedQuestion = registry.redact(question)

      const id = nextFollowUpId.current
      nextFollowUpId.current += 1
      const history = followUps
        .filter((item) => item.status === 'done' && item.answer)
        .slice(-3)
        .map((item) => ({ question: item.redactedQuestion, answer: item.answer!.text }))

      setFollowUps((current) => [...current, { id, question, redactedQuestion, status: 'pending' }])
      start('ask')
      try {
        // After strict mode the document must still never leave, so the
        // follow-up is answered by Gemini Nano on this device.
        const result = strictTrail
          ? await answerFollowUpOnDevice(registry.redact(doc.text), history, redactedQuestion, streamTo('ask'))
          : await answerFollowUp(registry.redact(doc.text), history, redactedQuestion, registry, streamTo('ask'))
        if (run !== runId.current) return
        setFollowUps((current) =>
          current.map((item) => (item.id === id ? { ...item, status: 'done', answer: toTextResult(result) } : item)),
        )
      } catch (caught) {
        if (run !== runId.current) return
        setFollowUps((current) =>
          current.map((item) => (item.id === id ? { ...item, status: 'error', error: describeError(caught) } : item)),
        )
      } finally {
        finish('ask')
      }
    },
    [doc, followUps, registry, strictTrail],
  )

  return {
    stage,
    doc,
    readingLabel,
    registry,
    version,
    detection,
    redacted,
    liveLeaks,
    leaks,
    error,
    busy,
    streams,
    explanation,
    quick,
    strictStep,
    strictTrail,
    quickTruncated: redacted.length > QUICK_READ_MAX_CHARS,
    simple,
    translations,
    terms,
    toolError,
    followUps,
    hasAnswer: Boolean(explanation || quick),
    loadFile,
    loadText,
    loadSample,
    reset,
    setEntryEnabled,
    addManual,
    explain,
    runStrictMode,
    runQuickRead,
    runSimplify,
    runTranslate,
    runDefine,
    ask,
    dismissError: () => setError(null),
  }
}

export type Session = ReturnType<typeof useSession>
