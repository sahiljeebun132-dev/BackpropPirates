import { useCallback, useState } from 'react'

type Position = { lat: number; lon: number }

/** The rider's own position, asked for only when they tap to use it.
 *
 *  Never requested on load: a permission prompt the moment an app opens is
 *  rude, and the app works perfectly well pinning a report to the middle of
 *  the route instead.
 */
export function useGeolocation(): {
  position: Position | null
  request: () => void
  denied: boolean
} {
  const [position, setPosition] = useState<Position | null>(null)
  const [denied, setDenied] = useState(false)

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setDenied(true)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPosition({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setDenied(true),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  }, [])

  return { position, request, denied }
}
