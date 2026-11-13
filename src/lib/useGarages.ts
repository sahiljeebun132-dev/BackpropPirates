import { useEffect, useState } from 'react'

import { distanceKm } from './geo'

export type Garage = {
  id: string
  kind: 'garage' | 'tyres' | 'parts' | 'fuel'
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

export const GARAGE_KIND_LABEL: Record<Garage['kind'], string> = {
  garage: 'Garage',
  tyres: 'Tyre shop',
  parts: 'Car parts',
  fuel: 'Filling station',
}

let cache: Promise<GarageData> | null = null
const EMPTY: GarageData = { garages: [], counts: {}, source: null }

function load(): Promise<GarageData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/garages.json`)
    .then((r) => (r.ok ? r.json() : EMPTY))
    .catch(() => {
      cache = null
      return EMPTY // never block the safety guidance on this
    })
  return cache
}

/** Nearest garages to a point, loaded the first time the roadside flow needs
 *  them. Community data, so the caller is expected to label it as such. */
export function useGarages(
  enabled: boolean,
  lat: number,
  lon: number,
): { nearest: (Garage & { km: number })[]; source: GarageData['source']; total: number } {
  const [data, setData] = useState<GarageData>(EMPTY)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void load().then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const here = { lat, lon }
  const nearest = data.garages
    .map((g) => ({ ...g, km: distanceKm(g, here) }))
    .sort((a, b) => a.km - b.km)

  return { nearest, source: data.source, total: data.garages.length }
}
