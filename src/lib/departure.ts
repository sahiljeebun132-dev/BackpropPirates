/** "You would be safer leaving at ..." — the part that prevents a trip rather
 *  than just describing one.
 *
 *  It walks forward in half-hour steps, scores the same journey at each one,
 *  and reports the first materially safer slot. Almost all of the movement
 *  comes from getting the rider out of darkness, which is the largest effect
 *  in the official data: 8.2% of casualties in unlit darkness are fatal
 *  against 3.7% in daylight.
 */

import { lightBandAt, rainOverTrip, RAIN_MM_THRESHOLD, type LiveConditions } from './live'
import { assessRoute } from './risk'
import type { AppData, Place, TravelMode } from './types'

/** Our assumptions, stated plainly because they are not from any dataset.
 *  The straight line between two towns understates the road, and traffic on
 *  Mauritian main roads is slow, so a door-to-door average is the honest unit. */
export const ROAD_DETOUR_FACTOR = 1.3
export const AVERAGE_SPEED_KMH = 40

export function estimateTripMinutes(directKm: number): number {
  return Math.max(5, Math.round(((directKm * ROAD_DETOUR_FACTOR) / AVERAGE_SPEED_KMH) * 60))
}

export type DepartureOption = {
  at: Date
  score: number
  minutesAway: number
  band: ReturnType<typeof lightBandAt>['band']
  rainMm: number
}

export type DepartureAdvice = {
  current: DepartureOption
  /** A clearly safer slot, when one exists. May be earlier than planned. */
  better: DepartureOption | null
  /** Every slot considered, for the small timeline strip. */
  options: DepartureOption[]
}

/** How many points better another slot must be before we suggest it. Below
 *  this the advice is noise and the rider should just go. */
const WORTH_SUGGESTING = 6

export function planDeparture(
  data: AppData,
  origin: Place,
  destination: Place,
  mode: TravelMode,
  conditions: LiveConditions,
  departAt: Date,
  roadIsLit: boolean,
  horizonHours = 10,
): DepartureAdvice {
  const directKm = assessRoute(data, origin, destination, mode, 'day').directDistanceKm
  const tripMinutes = estimateTripMinutes(directKm)

  const score = (at: Date): DepartureOption => {
    const { band } = lightBandAt(conditions, at, roadIsLit)
    const rain = rainOverTrip(conditions, at, tripMinutes)
    return {
      at,
      score: assessRoute(data, origin, destination, mode, band).score,
      minutesAway: Math.round((at.getTime() - departAt.getTime()) / 60_000),
      band,
      rainMm: rain.totalMm,
    }
  }

  // Search both directions around the planned time, not just forward. Someone
  // who plans to ride at dusk is helped by leaving earlier, and telling them
  // to wait until sunrise would be useless. The window never starts before
  // now, because advice about a departure already in the past is no advice.
  const now = Date.now()
  const start = Math.max(now, departAt.getTime() - horizonHours * 3_600_000)
  const end = departAt.getTime() + horizonHours * 3_600_000
  const STEP = 30 * 60_000

  const options: DepartureOption[] = []
  for (let t = Math.ceil(start / STEP) * STEP; t <= end; t += STEP) {
    const at = new Date(t)
    if (!conditions.sun[dayKey(at)]) continue // outside the forecast window
    options.push(score(at))
  }

  const current = score(departAt)

  // Take the safest slot within a shift the rider could plausibly make, and
  // break ties towards the one nearest their plan. Picking merely the first
  // slot that cleared the bar suggested dusk when full daylight was half an
  // hour further out, which is worse advice for the same inconvenience.
  const WITHIN_MINUTES = 180
  const better =
    options
      .filter(
        (o) =>
          Math.abs(o.minutesAway) >= 20 &&
          Math.abs(o.minutesAway) <= WITHIN_MINUTES &&
          o.score - current.score >= WORTH_SUGGESTING &&
          o.rainMm < Math.max(current.rainMm, RAIN_MM_THRESHOLD),
      )
      .sort((a, b) => b.score - a.score || Math.abs(a.minutesAway) - Math.abs(b.minutesAway))[0] ??
    null

  return { current, better, options }
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
