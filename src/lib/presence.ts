/**
 * Telling other riders you are here, and finding out who else is.
 *
 * Off unless the rider turns it on, every time — this does not remember
 * being enabled. An app that silently resumed broadcasting a position
 * because of a tap three weeks ago would be the single worst thing in a
 * product whose argument is that it asks for nothing.
 *
 * The id is made fresh for each session and never written down. It is not
 * the install id used for the demo room, because that one persists and
 * joining the two would turn an anonymous dot into a trackable device.
 *
 * Positions are rounded here as well as on the server. A hundred metres is
 * enough to draw "somebody is on your road" and not enough to pick out a
 * bike, and rounding before the request means the exact figure never leaves
 * the phone at all.
 */

const ENDPOINT = '/api/nearby'

/** The Android build is served from the APK, so relative URLs go nowhere. */
const BASE =
  typeof window !== 'undefined' && window.location.origin.startsWith('https://localhost')
    ? 'https://backprop-pirates.vercel.app'
    : ''

/** How often to say "still here". The server forgets after two minutes, so
 *  this has to be comfortably inside that without being chatty. */
export const BEAT_MS = 20_000

/** Deliberately not persisted. A new session is a new stranger. */
let sessionId: string | null = null

function id(): string {
  if (sessionId === null) {
    sessionId = Math.random().toString(36).slice(2, 12)
  }
  return sessionId
}

/** Forget who we were. Called when sharing is switched off, so switching it
 *  on again is a different anonymous dot rather than the same one resuming. */
export function forgetSession(): void {
  sessionId = null
}

/** Three decimals, about a hundred metres at this latitude. */
const coarse = (n: number): number => Math.round(n * 1000) / 1000

export type Rider = [number, number]

/**
 * Say where you are and get back who is near.
 *
 * One request does both, because two would mean the phone talking twice as
 * often for the same picture.
 */
export async function beat(
  lat: number,
  lon: number,
  km = 5,
): Promise<Rider[] | null> {
  try {
    const res = await fetch(`${BASE}${ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id(), lat: coarse(lat), lon: coarse(lon), km }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { riders?: Rider[] }
    return body.riders ?? []
  } catch {
    return null
  }
}

/**
 * Who is near, without saying where you are.
 *
 * This is the read-only half, for a rider who wants to see the road without
 * joining it. It is the default: looking costs nothing and tells nobody
 * anything, so it should not require a decision.
 */
export async function lookOnly(lat: number, lon: number, km = 5): Promise<Rider[] | null> {
  try {
    const res = await fetch(
      `${BASE}${ENDPOINT}?lat=${coarse(lat)}&lon=${coarse(lon)}&km=${km}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { riders?: Rider[] }
    return body.riders ?? []
  } catch {
    return null
  }
}
