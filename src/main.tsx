import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { firebaseConfigured, getFirebaseApp } from './firebase'

// Start Firebase and App Check as soon as the page loads, so the App Check
// debug token is printed to the console on localhost before any model call.
if (firebaseConfigured) {
  try {
    getFirebaseApp()
  } catch (error) {
    console.error('[Veil] Firebase could not start:', error)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
