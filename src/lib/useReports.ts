import { useCallback, useEffect, useState } from 'react'

import { fetchReports, type HazardReport } from './reports'

/** How often the feed refreshes while the results screen is open. Short enough
 *  that a report reaches the next rider quickly, long enough to be civil to a
 *  function on a free tier. */
const POLL_MS = 30_000

type State = {
  reports: HazardReport[]
  status: 'loading' | 'ready' | 'error'
  refresh: () => void
}

export function useReports(lat: number | null, lon: number | null, radiusKm: number): State {
  const [reports, setReports] = useState<HazardReport[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (lat === null || lon === null) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    const load = async () => {
      try {
        const next = await fetchReports(lat, lon, radiusKm, controller.signal)
        setReports(next)
        setStatus('ready')
      } catch {
        // An aborted request is just the corridor changing, not a failure.
        if (!controller.signal.aborted) setStatus('error')
      }
      if (!controller.signal.aborted) timer = setTimeout(load, POLL_MS)
    }
    void load()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [lat, lon, radiusKm, nonce])

  return { reports, status, refresh }
}
