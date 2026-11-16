import { useEffect, useSyncExternalStore } from 'react'
import { getDeviceState, refreshDeviceStatus, subscribeDeviceState, type DeviceState } from './hybrid'

/**
 * React hook for the on-device model status:
 * checking, unavailable, downloadable, downloading or ready.
 */
export function useDeviceModel(): DeviceState {
  const state = useSyncExternalStore(subscribeDeviceState, getDeviceState)

  useEffect(() => {
    void refreshDeviceStatus()
    // Chrome may finish a download in the background, and availability can
    // change when the tab regains focus, so re-check then.
    const onFocus = () => void refreshDeviceStatus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return state
}
