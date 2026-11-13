import { useEffect, useState } from 'react'

import { distanceKm } from './geo'

export type Garage = {
  id: string
  kind: 'garage' | 'tyres' | 'parts' | 'fuel' | 'dealer' | 'motorcycle' | 'inspection'
  name: string
  phone: string | null
  lat: number
  lon: number
  street: string | null
  town: string | null
  hours: string | null
}

export type GarageData = {
  garages: Garage[]
  counts: Record<string, number>
  withPhone?: number
  source: { name: string; via: string; licence: string; note: string } | null
}

/** Why the list is empty, which is not one question but three.
 *
 *  Conflating them produced a real bug: the panel told riders "the garage
 *  list has not loaded" on a screen where it had never been asked to load.
 *  That reads as a broken app, and it was the message that was broken.
 */
export type GarageStatus = 'idle' | 'loading' | 'ready' | 'failed'

export const GARAGE_KIND_LABEL: Record<Garage['kind'], string> = {
  garage: 'Garage',
  tyres: 'Tyre shop',
  parts: 'Car parts',
  fuel: 'Filling station',
  dealer: 'Dealer and service',
  motorcycle: 'Motorcycle garage',
  inspection: 'Vehicle inspection',
}

let cache: Promise<GarageData> | null = null
const EMPTY: GarageData = { garages: [], counts: {}, source: null }

function load(): Promise<GarageData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/garages.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`garages ${r.status}`)
      return r.json() as Promise<GarageData>
    })
    .catch((e: unknown) => {
      cache = null // so a later screen can try again
      throw e
    })
  return cache
}

/** Nearest garages to a point, loaded the first time the roadside flow needs
 *  them. Community data, so the caller is expected to label it as such. */
export function useGarages(
  enabled: boolean,
  lat: number,
  lon: number,
): {
  nearest: (Garage & { km: number })[]
  source: GarageData['source']
  total: number
  status: GarageStatus
} {
  const [loaded, setLoaded] = useState<GarageData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    load().then(
      (d) => {
        if (!cancelled) setLoaded(d)
      },
      () => {
        // Never block the safety guidance on this: the emergency numbers and
        // every repair step still work without a garage list.
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [enabled])

  // Derived rather than stored, so nothing has to be set synchronously inside
  // the effect just to describe what the effect is doing.
  const status: GarageStatus = !enabled
    ? 'idle'
    : failed
      ? 'failed'
      : loaded
        ? 'ready'
        : 'loading'

  const data = loaded ?? EMPTY
  const here = { lat, lon }
  const nearest = data.garages
    .map((g) => ({ ...g, km: distanceKm(g, here) }))
    .sort((a, b) => a.km - b.km)

  return { nearest, source: data.source, total: data.garages.length, status }
}
