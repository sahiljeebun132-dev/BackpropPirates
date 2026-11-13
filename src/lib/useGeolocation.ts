import { useCallback, useState } from 'react'

import { getFix } from './position'

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
    void getFix({ timeoutMs: 8_000, maxAgeMs: 60_000 }).then((fix) => {
      if (fix) setPosition({ lat: fix.lat, lon: fix.lon })
      else setDenied(true)
    })
  }, [])

  return { position, request, denied }
}
