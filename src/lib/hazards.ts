import type { HourlyPoint } from './live'
import type { TravelMode } from './types'

/**
 * Conditions on this corridor that are dangerous in themselves, as opposed
 * to the long-run exposure the score measures.
 *
 * The line this module will not cross: these are **our** advisories, worked
 * out from an open weather forecast. They are not warnings from the
 * Mauritius Meteorological Services, which is the only body that declares a
 * cyclone class, and the panel says so and links to them. Dressing a
 * forecast up as an official warning would be the same sin as inventing a
 * casualty figure — worse, because somebody might stay on the road or leave
 * it on the strength of it.
 *
 * Thresholds are deliberately conservative and are stated on screen, so a
 * judge or a rider can disagree with the number rather than the idea.
 */

export type HazardLevel = 'advisory' | 'serious' | 'severe'

export type Hazard = {
  id: string
  level: HazardLevel
  title: string
  detail: string
  /** What to actually do, which is the only part that matters at the time. */
  action: string
}

/** Gusts, in km/h. A two-wheeler is moved by wind long before a car is. */
export const GUST_RIDER_KMH = 45
export const GUST_SERIOUS_KMH = 65
export const GUST_SEVERE_KMH = 90
/** Above this, a forecast is beside the point: follow the official class. */
export const GUST_CYCLONE_KMH = 120

/** Hourly rainfall, in mm. Mauritius flash-floods on short, intense bursts. */
export const RAIN_FLOOD_MM = 10
export const RAIN_TORRENT_MM = 20

/** Metres. Below this, a rider is hard to see and hard-pressed to see. */
export const VISIBILITY_POOR_M = 2000
export const VISIBILITY_BAD_M = 800

const peak = (hours: HourlyPoint[], pick: (h: HourlyPoint) => number | null): number =>
  hours.reduce((best, h) => Math.max(best, pick(h) ?? 0), 0)

const low = (hours: HourlyPoint[], pick: (h: HourlyPoint) => number | null): number | null => {
  const vals = hours.map(pick).filter((v): v is number => v !== null)
  return vals.length ? Math.min(...vals) : null
}

/**
 * Hazards over the hours the rider will actually be travelling.
 *
 * `twoWheeler` lowers the wind thresholds rather than adding a separate
 * warning, because the same gust is a different event on a motorcycle.
 */
export function hazardsFor(hours: HourlyPoint[], mode: TravelMode): Hazard[] {
  if (hours.length === 0) return []
  const twoWheeler = mode === 'motorcycle' || mode === 'pedestrian'
  const out: Hazard[] = []

  // ---- wind
  const gust = Math.round(peak(hours, (h) => h.windGustKmh))
  if (gust >= GUST_CYCLONE_KMH) {
    out.push({
      id: 'wind-cyclone',
      level: 'severe',
      title: `Cyclone-force gusts forecast, around ${gust} km/h`,
      detail:
        'At this strength the forecast stops being the thing that matters. The Mauritius Meteorological Services declares cyclone classes and the police close roads; follow them, not this app.',
      action: 'Do not travel. Check the official cyclone class before you plan anything.',
    })
  } else if (gust >= GUST_SEVERE_KMH) {
    out.push({
      id: 'wind-severe',
      level: 'severe',
      title: `Severe gusts forecast, around ${gust} km/h`,
      detail:
        'Strong enough to bring down branches and move an unloaded vehicle across a lane. Exposed coast roads and bridges are the worst of it.',
      action: twoWheeler
        ? 'Do not ride. This is past what a two-wheeler can be held straight in.'
        : 'Postpone if you can. If you must drive, both hands on the wheel and well under the limit.',
    })
  } else if (gust >= (twoWheeler ? GUST_RIDER_KMH : GUST_SERIOUS_KMH)) {
    out.push({
      id: 'wind-strong',
      level: 'serious',
      title: `Strong gusts forecast, around ${gust} km/h`,
      detail: twoWheeler
        ? 'Enough to push a motorcycle across part of a lane, particularly coming out from behind a lorry or a building.'
        : 'Enough to be felt at the wheel, most on exposed stretches and when overtaking high-sided vehicles.',
      action: twoWheeler
        ? 'Slow down, leave more room, and expect to be pushed when you come out of shelter.'
        : 'Leave more room around two-wheelers. The gust that nudges you will move them much further.',
    })
  }

  // ---- rain and flooding
  const rain = peak(hours, (h) => h.precipitationMm)
  if (rain >= RAIN_TORRENT_MM) {
    out.push({
      id: 'rain-torrent',
      level: 'severe',
      title: `Torrential rain forecast, up to ${rain.toFixed(0)} mm in an hour`,
      detail:
        'This is the rate at which Mauritian roads flash-flood. Water crosses low-lying stretches and drains back up with no warning.',
      action:
        'Do not travel if it can wait. Never ride or drive into standing water — you cannot see how deep it is or whether the road is still under it.',
    })
  } else if (rain >= RAIN_FLOOD_MM) {
    out.push({
      id: 'rain-heavy',
      level: 'serious',
      title: `Heavy rain forecast, up to ${rain.toFixed(0)} mm in an hour`,
      detail:
        'Standing water, poor grip and spray. Pooled 2013 to 2018, the fatal share of casualty accidents in wet conditions is 5.88% against 4.67% dry.',
      action: twoWheeler
        ? 'Slow right down, brake earlier and in a straight line, and keep off painted lines and metal covers.'
        : 'Slow down, double your following distance, and watch for riders who have nowhere dry to go.',
    })
  }

  // ---- visibility
  const vis = low(hours, (h) => h.visibilityM)
  if (vis !== null && vis <= VISIBILITY_BAD_M) {
    out.push({
      id: 'vis-bad',
      level: 'serious',
      title: `Very poor visibility forecast, down to about ${Math.round(vis)} m`,
      detail:
        'Mist on the central plateau and heavy rain both do this, and it arrives faster than people expect on the climb to Curepipe.',
      action: 'Dipped headlights on, not full beam. Slow to a speed you could stop inside what you can see.',
    })
  } else if (vis !== null && vis <= VISIBILITY_POOR_M) {
    out.push({
      id: 'vis-poor',
      level: 'advisory',
      title: `Reduced visibility forecast, around ${Math.round(vis / 100) / 10} km`,
      detail: 'Enough to matter on an unlit road, where a rider in dark clothing disappears entirely.',
      action: 'Headlights on and anything reflective turned outwards.',
    })
  }

  return out
}

export const LEVEL_LABEL: Record<HazardLevel, string> = {
  advisory: 'Worth knowing',
  serious: 'Take care',
  severe: 'Do not travel if it can wait',
}

/** The body that actually declares cyclone classes and closes roads. */
export const OFFICIAL_SOURCE = {
  name: 'Mauritius Meteorological Services',
  url: 'http://metservice.intnet.mu/',
  note:
    'Cyclone classes, heavy-rain and flash-flood warnings are issued by the Mauritius Meteorological Services. Zetway does not issue warnings and cannot see theirs; what is above is worked out from an open weather forecast and is our reading of it, not an official bulletin.',
}
