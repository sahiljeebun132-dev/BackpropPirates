import { useEffect, useState } from 'react'

/** The car list is 147 KB and only the roadside flow needs it, so it is
 *  fetched the first time that screen opens rather than on app start. */
let cache: Promise<string[]> | null = null

function load(): Promise<string[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/cars.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`cars ${r.status}`)
      return r.json()
    })
    .then((j: { cars: string[] }) => j.cars ?? [])
    .catch(() => {
      cache = null // allow a later retry
      return [] // a missing list must never block the safety guidance
    })
  return cache
}

export function useCars(enabled: boolean): string[] {
  const [cars, setCars] = useState<string[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void load().then((c) => {
      if (!cancelled) setCars(c)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return cars
}

/** Best few matches for what has been typed. Entries that start with the
 *  query rank above ones that merely contain it, so "swift" offers the
 *  Suzuki before Swift Engineering's racing cars. */
export function searchCars(cars: string[], query: string, limit = 7): string[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const starts: string[] = []
  const contains: string[] = []
  for (const car of cars) {
    const lower = car.toLowerCase()
    if (lower.startsWith(q)) starts.push(car)
    else if (lower.includes(q)) contains.push(car)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}

const KEY = 'zetway.car'

export function readSavedCar(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return '' // private mode, or storage blocked
  }
}

export function saveCar(value: string): void {
  try {
    if (value) localStorage.setItem(KEY, value)
    else localStorage.removeItem(KEY)
  } catch {
    // Remembering the car is a convenience, never a requirement.
  }
}
