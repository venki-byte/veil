/**
 * Loads app settings from Firebase Remote Config.
 *
 * In the Firebase console (Run > Remote Config) you can add:
 *   model_name        e.g. gemini-4-hydrogen   (cloud model)
 *   detection_passes  1 or 2                   (on-device detection passes)
 * and publish, and the app picks them up without a new release. Until then,
 * or offline, the defaults in settings.ts are used.
 */

import type { FirebaseApp } from 'firebase/app'
import { fetchAndActivate, getRemoteConfig, getString } from 'firebase/remote-config'
import { DEFAULT_CONFIG, parseConfig, REMOTE_KEYS, type AppConfig } from './settings'

const envModel = import.meta.env.VITE_CLOUD_MODEL as string | undefined

let current: AppConfig = parseConfig(null, envModel)
let loading: Promise<AppConfig> | null = null

export function getConfig(): AppConfig {
  return current
}

/** Fetches Remote Config once. Never throws: on any problem the defaults stay. */
export function loadRemoteConfig(app: FirebaseApp): Promise<AppConfig> {
  loading ??= (async () => {
    try {
      const remoteConfig = getRemoteConfig(app)
      // Fetch at most once an hour in production; every minute while developing.
      remoteConfig.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000
      remoteConfig.settings.fetchTimeoutMillis = 8_000
      remoteConfig.defaultConfig = {
        [REMOTE_KEYS.modelName]: DEFAULT_CONFIG.modelName,
        [REMOTE_KEYS.detectionPasses]: String(DEFAULT_CONFIG.detectionPasses),
      }
      await fetchAndActivate(remoteConfig)
      current = parseConfig(
        {
          modelName: getString(remoteConfig, REMOTE_KEYS.modelName),
          detectionPasses: getString(remoteConfig, REMOTE_KEYS.detectionPasses),
        },
        envModel,
      )
    } catch (error) {
      console.warn('[Veil] Remote Config could not be loaded; using the built-in defaults.', error)
    }
    return current
  })()
  return loading
}
