/**
 * The road network, fetched the first time a map needs it.
 *
 * 167 KB on disk and about 42 KB over the wire, which is more than any other
 * single file this app carries — so it is not part of the bundle every rider
 * downloads to check a score. It loads when the live map opens, once, and
 * the service worker keeps it after that, which is what makes the map work
 * in airplane mode on the second run.
 *
 * A map with no roads is still a map here: the hazard layer, the towns and
 * the hospitals all come from data that is already loaded. So a failure to
 * fetch this returns an empty list rather than an error, and the screen
 * simply draws what it has.
 */

export type RoadWay = {
  /** 0 tertiary … 4 motorway. Decides the stroke width and the draw order. */
  c: number
  /** [lat, lon] pairs, already simplified to about a metre. */
  p: [number, number][]
}

export type Roads = {
  source: string
  classes: string[]
  ways: RoadWay[]
}

const EMPTY: Roads = { source: '', classes: [], ways: [] }

let cache: Roads | null = null
let inFlight: Promise<Roads> | null = null

export function loadedRoads(): Roads | null {
  return cache
}

export async function loadRoads(): Promise<Roads> {
  if (cache) return cache
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/roads.json`)
      if (!res.ok) throw new Error(String(res.status))
      cache = (await res.json()) as Roads
      return cache
    } catch {
      // The map is still worth drawing without them.
      cache = EMPTY
      return cache
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}
