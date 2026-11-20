import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { loadRemoteConfig } from './config/remote'
import { installConsoleCapture } from './diagnostics/consoleLog'
import { firebaseConfigured, getFirebaseApp } from './firebase'

// Keep recent console errors in memory so the diagnostic report can include them.
installConsoleCapture()

// Start Firebase and App Check as soon as the page loads, so the App Check
// debug token is printed to the console on localhost before any model call.
// Remote Config loads in the background; the built-in defaults apply until it
// arrives, and stay if it cannot be fetched (for example offline).
if (firebaseConfigured) {
  try {
    void loadRemoteConfig(getFirebaseApp())
  } catch (error) {
    console.error('[Veil] Firebase could not start:', error)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
