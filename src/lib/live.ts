/** Live conditions on the corridor, from Open-Meteo.
 *
 * Free, no API key, no account, global coverage including Mauritius. The
 * forecast comes from national weather models, which ingest satellite and radar
 * observations, so this is remote-sensed data arriving hourly rather than
 * imagery we would have to interpret ourselves.
 *
 * Two things come out of it, and they are used very differently:
 *
 *   Sunrise and sunset  ->  which official light condition the trip falls in.
 *       This matters a lot: 8.2% of casualties in unlit darkness are fatal
 *       against 3.7% in daylight. It drives the score.
 *
 *   Rain at the departure hour  ->  advice only.
 *       Pooled over 2013-2018, rain raises the fatal share from 4.67% to 5.88%,
 *       a ratio of 1.26. Real, but modest, and only 8% of casualty accidents
 *       happen in the wet. Letting it swing the score would overstate it.
 */

import type { TimeBand } from './types'

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

/** Rain in an hour at or above this is heavy enough to mention. Open-Meteo
 *  reports millimetres per hour; 2.5 mm/h is the conventional line between
 *  light and moderate rain. */
export const RAIN_MM_THRESHOLD = 2.5
/** Mauritius flash-floods. At this hourly rate, standing water is the hazard. */
export const HEAVY_RAIN_MM = 10

export type HourlyPoint = {
  time: Date
  precipitationMm: number
  visibilityM: number | null
}

export type LiveConditions = {
  latitude: number
  longitude: number
  fetchedAt: Date
  /** Keyed by the local date, 'YYYY-MM-DD'. */
  sun: Record<string, { sunrise: Date; sunset: Date }>
  hourly: HourlyPoint[]
}

const cache = new Map<string, Promise<LiveConditions>>()

const localDayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Open-Meteo returns local wall-clock stamps with no offset. Parsing those
 *  with `new Date()` would apply the viewer's timezone, which is wrong for
 *  anyone demoing from another country, so build the date from the parts. */
function parseLocal(stamp: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp)
  if (!m) return new Date(stamp)
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0)
}

export function fetchLiveConditions(lat: number, lon: number): Promise<LiveConditions> {
  // One request per rounded location: the forecast grid is far coarser than
  // the difference between two Mauritian towns on the same corridor.
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const hit = cache.get(key)
  if (hit) return hit

  const url =
    `${ENDPOINT}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    '&hourly=precipitation,visibility' +
    '&daily=sunrise,sunset' +
    '&forecast_days=2&timezone=Indian%2FMauritius'

  // A free public endpoint returns the occasional 503 under load, and we saw
  // one in testing. One retry turns a blip into nothing the rider notices.
  const getOnce = async (): Promise<Response> => {
    const res = await fetch(url)
    if (res.ok) return res
    throw new Error(`weather ${res.status}`)
  }

  const promise = getOnce()
    .catch(async () => {
      await new Promise((r) => setTimeout(r, 700))
      return getOnce()
    })
    .then(async (res) => {
      const j = await res.json()
      const sun: LiveConditions['sun'] = {}
      for (let i = 0; i < (j.daily?.time?.length ?? 0); i += 1) {
        sun[j.daily.time[i]] = {
          sunrise: parseLocal(j.daily.sunrise[i]),
          sunset: parseLocal(j.daily.sunset[i]),
        }
      }
      const hourly: HourlyPoint[] = (j.hourly?.time ?? []).map((t: string, i: number) => ({
        time: parseLocal(t),
        precipitationMm: j.hourly.precipitation?.[i] ?? 0,
        visibilityM: j.hourly.visibility?.[i] ?? null,
      }))
      return { latitude: lat, longitude: lon, fetchedAt: new Date(), sun, hourly }
    })
    .catch((err: unknown) => {
      cache.delete(key) // let a later attempt retry rather than caching the failure
      throw err
    })

  cache.set(key, promise)
  return promise
}

/** Which official light category a departure falls into.
 *
 *  Civil twilight in Mauritius runs roughly 25 minutes either side of the sun
 *  crossing the horizon, so that window is treated as dawn or dusk.
 *
 *  Whether a road is lit is something the forecast cannot know, so the caller
 *  passes what the rider says about their own route.
 */
export const TWILIGHT_MINUTES = 25

export function lightBandAt(
  conditions: LiveConditions,
  when: Date,
  roadIsLit: boolean,
): { band: TimeBand; sunrise: Date | null; sunset: Date | null } {
  const day = conditions.sun[localDayKey(when)]
  if (!day) return { band: roadIsLit ? 'night-lit' : 'night-unlit', sunrise: null, sunset: null }

  const t = when.getTime()
  const edge = TWILIGHT_MINUTES * 60_000
  const { sunrise, sunset } = day

  let band: TimeBand
  if (t >= sunrise.getTime() + edge && t <= sunset.getTime() - edge) band = 'day'
  else if (Math.abs(t - sunrise.getTime()) <= edge || Math.abs(t - sunset.getTime()) <= edge)
    band = 'dawn-dusk'
  else band = roadIsLit ? 'night-lit' : 'night-unlit'

  return { band, sunrise, sunset }
}

/** Rain forecast for the hour a trip starts. */
export function rainAt(conditions: LiveConditions, when: Date): HourlyPoint | null {
  const hourStart = new Date(when)
  hourStart.setMinutes(0, 0, 0)
  const target = hourStart.getTime()
  return conditions.hourly.find((h) => h.time.getTime() === target) ?? null
}

/** Rain over the whole trip, not just the hour it starts in. */
export function rainOverTrip(
  conditions: LiveConditions,
  start: Date,
  durationMinutes: number,
): { totalMm: number; peakMm: number; hours: number } {
  const from = start.getTime()
  const to = from + durationMinutes * 60_000
  const span = conditions.hourly.filter(
    (h) => h.time.getTime() + 3_600_000 > from && h.time.getTime() < to,
  )
  return {
    totalMm: span.reduce((s, h) => s + h.precipitationMm, 0),
    peakMm: span.reduce((s, h) => Math.max(s, h.precipitationMm), 0),
    hours: span.length,
  }
}
