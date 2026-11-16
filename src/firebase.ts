/**
 * Firebase app and App Check setup.
 *
 * Config values come from .env (see .env.example). They identify the Firebase
 * project and are safe to ship in a web app; the Gemini API key itself is
 * held by Firebase AI Logic and never appears in this code.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  type AppCheckOptions,
} from 'firebase/app-check'

const env = import.meta.env

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

/** True when the minimum Firebase config has been provided in .env. */
export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId)

export type AppCheckMode = 'debug' | 'recaptcha' | 'missing'

let app: FirebaseApp | null = null
let appCheckMode: AppCheckMode = 'missing'

export class NotConfiguredError extends Error {
  constructor() {
    super('Firebase is not configured. Copy .env.example to .env and add your Firebase web app config.')
    this.name = 'NotConfiguredError'
  }
}

function isLocalhost(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname ?? '')
}

function setUpAppCheck(firebaseApp: FirebaseApp): AppCheckMode {
  const enterpriseKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined
  const v3Key = env.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined
  const local = isLocalhost()

  let provider: AppCheckOptions['provider'] | null = null
  if (enterpriseKey) provider = new ReCaptchaEnterpriseProvider(enterpriseKey)
  else if (v3Key) provider = new ReCaptchaV3Provider(v3Key)

  if (local) {
    // Debug provider. With `true` the SDK creates a debug token, prints it to
    // the browser console once, and reuses it. Register that token in the
    // Firebase console under App Check > Apps > Manage debug tokens.
    // A token can also be supplied through .env.local, which is not committed.
    const debugToken = (env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined) || true
    ;(globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken
    // In debug mode the SDK exchanges the debug token and never asks the
    // provider, so no reCAPTCHA key is needed for local development.
    provider ??= new CustomProvider({
      getToken: () => Promise.reject(new Error('App Check debug mode: provider is not used.')),
    })
  }

  if (!provider) {
    console.warn(
      '[Veil] App Check is not set up for this host. Set VITE_RECAPTCHA_ENTERPRISE_SITE_KEY ' +
        '(or VITE_RECAPTCHA_V3_SITE_KEY) before deploying, or cloud calls may be rejected.',
    )
    return 'missing'
  }

  initializeAppCheck(firebaseApp, { provider, isTokenAutoRefreshEnabled: true })
  return local ? 'debug' : 'recaptcha'
}

/** Returns the Firebase app, creating it (and App Check) on first use. */
export function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured) throw new NotConfiguredError()
  if (!app) {
    app = initializeApp(config)
    appCheckMode = setUpAppCheck(app)
  }
  return app
}

export function getAppCheckMode(): AppCheckMode {
  return appCheckMode
}
