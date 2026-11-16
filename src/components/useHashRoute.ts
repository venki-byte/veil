import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** Tiny hash router. Returns the current route, e.g. "/" or "/routing". */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, '') || '/')
}
