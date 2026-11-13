import { useEffect, useState } from 'react'

import { fetchLiveConditions, type LiveConditions } from './live'

type Result =
  | { key: string; conditions: LiveConditions }
  | { key: string; error: string }

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; conditions: LiveConditions }
  | { status: 'error'; message: string }

const keyOf = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`

/** Live conditions for one point, usually the midpoint of the corridor.
 *
 *  Loading is derived rather than stored: the effect only writes state when a
 *  request actually finishes, so changing corridor does not trigger a render
 *  just to say "loading" and then another to say "ready".
 *
 *  Kept deliberately separate from the official data hook. If the venue wifi
 *  drops mid-demo this is the only thing that fails, and the app falls back to
 *  the rider choosing the light condition by hand.
 */
export function useLive(lat: number | null, lon: number | null): State {
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (lat === null || lon === null) return
    const key = keyOf(lat, lon)
    let cancelled = false
    fetchLiveConditions(lat, lon)
      .then((conditions) => {
        if (!cancelled) setResult({ key, conditions })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({ key, error: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [lat, lon])

  if (lat === null || lon === null) return { status: 'idle' }

  const key = keyOf(lat, lon)
  if (!result || result.key !== key) return { status: 'loading' }
  return 'error' in result
    ? { status: 'error', message: result.error }
    : { status: 'ready', conditions: result.conditions }
}
