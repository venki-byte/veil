/**
 * App settings that can be changed without a new release.
 *
 * Values come from Firebase Remote Config (see remote.ts) with safe
 * defaults. This file is plain code: it only checks and parses values, so a
 * typo in the console can never break the app.
 */

export interface AppConfig {
  /** Cloud model for explanations and other cloud tasks. */
  modelName: string
  /** Used automatically if the main model is unavailable for this project. */
  fallbackModel: string
  /** On-device detection passes: 1 (broad) or 2 (broad, then people and organisations). */
  detectionPasses: 1 | 2
  /** Where the values came from, for the diagnostic report. */
  source: 'defaults' | 'remote config' | '.env'
}

/**
 * gemini-3.5-flash-lite is the SDK's own default hybrid model. In testing on
 * 2026-11-20 it explained a document in about 5 seconds. gemini-4-hydrogen,
 * which Firebase recommends, gave richer answers but took 150 seconds or
 * timed out, so it is not the default; Remote Config can switch to it.
 * gemini-3.8-flash needs no billing and is used only if the main model fails.
 */
export const DEFAULT_CONFIG: AppConfig = {
  modelName: 'gemini-3.5-flash-lite',
  fallbackModel: 'gemini-3.8-flash',
  detectionPasses: 2,
  source: 'defaults',
}

/** Remote Config parameter names. `model_name` is the name Firebase's docs use. */
export const REMOTE_KEYS = {
  modelName: 'model_name',
  detectionPasses: 'detection_passes',
} as const

const MODEL_NAME = /^gemini-[a-z0-9][a-z0-9.-]{1,60}$/

/** Accepts only well-formed Gemini model names. */
export function isValidModelName(value: unknown): value is string {
  return typeof value === 'string' && MODEL_NAME.test(value.trim())
}

export interface RawConfig {
  modelName?: string
  detectionPasses?: string
}

/**
 * Builds the app configuration. An explicit VITE_CLOUD_MODEL in .env wins,
 * for local testing; then Remote Config; then the defaults. Invalid values
 * are ignored.
 */
export function parseConfig(remote: RawConfig | null, envModel?: string): AppConfig {
  const config: AppConfig = { ...DEFAULT_CONFIG }

  if (remote) {
    let used = false
    if (isValidModelName(remote.modelName)) {
      config.modelName = remote.modelName.trim()
      used = remote.modelName.trim() !== DEFAULT_CONFIG.modelName
    }
    const passes = remote.detectionPasses?.trim()
    if (passes === '1' || passes === '2') {
      config.detectionPasses = passes === '1' ? 1 : 2
      used ||= config.detectionPasses !== DEFAULT_CONFIG.detectionPasses
    }
    if (used) config.source = 'remote config'
  }

  if (isValidModelName(envModel)) {
    config.modelName = envModel.trim()
    config.source = '.env'
  }

  return config
}

/**
 * Whether a cloud error looks like a problem with the model itself (not
 * found, not enabled for this project, needs billing, out of quota or
 * overloaded), so that trying the fallback model makes sense. App Check and
 * network errors are not model problems: another model would fail the same way.
 */
export function isModelProblem(message: string): boolean {
  if (/app\s?check|offline|failed to fetch|network/i.test(message)) return false
  return /\b(404|429|503|504)\b|not found|not supported|unsupported model|billing|quota|resource.?exhausted|overloaded|unavailable|is not available|permission.*model|model.*permission|timeout|timed out|took longer than|deadline/i.test(
    message,
  )
}
