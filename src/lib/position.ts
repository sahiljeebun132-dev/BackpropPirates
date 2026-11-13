import { Geolocation } from '@capacitor/geolocation'

import { isNative } from './platform'

export type Fix = { lat: number; lon: number; accuracy: number }

/**
 * One fix, by whichever route this build has.
 *
 * `navigator.geolocation` does exist inside the Android web view, but it only
 * works once the host activity has granted the runtime permission, and a web
 * view that is refused tends to hang rather than call the error callback. The
 * native API asks properly and fails fast, which matters here more than
 * anywhere else in the app: this is the call standing between a crashed rider
 * and a text message that says where they are.
 *
 * Resolves to null rather than throwing. A missing location degrades the
 * message to "location unavailable"; it must never stop it being sent.
 */
export async function getFix(options: { timeoutMs?: number; maxAgeMs?: number } = {}): Promise<Fix | null> {
  const timeout = options.timeoutMs ?? 10_000
  const maximumAge = options.maxAgeMs ?? 30_000

  if (isNative()) {
    try {
      const status = await Geolocation.checkPermissions()
      if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
        const asked = await Geolocation.requestPermissions({ permissions: ['location'] })
        if (asked.location !== 'granted' && asked.coarseLocation !== 'granted') return null
      }
      const p = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout,
        maximumAge,
      })
      return { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }
    } catch {
      return null
    }
  }

  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge },
    )
  })
}
