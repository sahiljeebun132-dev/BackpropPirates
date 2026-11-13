import { useEffect, useState } from 'react'

import type { AppData } from './types'

const FILES = [
  'places', 'hotspots', 'districts', 'conditions', 'emergency', 'exposure', 'island',
] as const

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: AppData }
  | { status: 'error'; message: string }

/** Loads the published data files once.
 *
 * They are static JSON under /data, so a service worker or a cache layer can be
 * dropped in front of this later without touching anything that calls it.
 */
export function useAppData(): State {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all(
      FILES.map(async (name) => {
        const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
        if (!res.ok) throw new Error(`${name}.json: ${res.status}`)
        return [name, await res.json()] as const
      }),
    )
      .then((entries) => {
        if (cancelled) return
        setState({ status: 'ready', data: Object.fromEntries(entries) as unknown as AppData })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
