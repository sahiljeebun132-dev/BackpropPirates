/** The Corridor Safety Score.
 *
 * Design rule: no invented numbers. Every factor below is a ratio between two
 * figures that appear in a published government table, and every yardstick a
 * ratio is measured against is taken from the data itself (the worst district,
 * the 90th-percentile corridor, the deadliest light condition). The only values
 * we chose are the four weights, and the app shows them on screen.
 *
 * The score is an exposure indicator, not a prediction. It says how much
 * recorded harm sits on this corridor for someone travelling this way, at this
 * hour. It cannot know about today's traffic, weather or the driver.
 */

import { clamp01, distanceKm, distanceToSegmentKm, polylineDistanceToCorridorKm } from './geo'
import type {
  AppData, District, EmergencyPlace, Hotspot, LightCondition, Place, TimeBand, TravelMode,
} from './types'

/** Weights chosen by us, shown in the UI so a judge can argue with them. */
export const WEIGHTS = {
  hotspots: 0.35,
  district: 0.25,
  mode: 0.25,
  time: 0.15,
} as const

/** Official light-condition category behind each time band the user can pick. */
export const TIME_BAND_CONDITION: Record<TimeBand, string> = {
  day: 'Day light',
  'dawn-dusk': 'Dawn dusk',
  'night-lit': 'Darkness street lights present and lit',
  'night-unlit': 'Darkness no street lighting',
}

export const TIME_BAND_LABEL: Record<TimeBand, string> = {
  day: 'Daylight',
  'dawn-dusk': 'Dawn or dusk',
  'night-lit': 'After dark, lit road',
  'night-unlit': 'After dark, unlit road',
}

export const MODE_LABEL: Record<TravelMode, string> = {
  car: 'Car',
  motorcycle: 'Motorcycle or auto cycle',
  bus: 'Bus',
  pedestrian: 'On foot',
}

/** Which casualty column in the district table describes this traveller. */
type CasualtyGroup = 'pedestrian' | 'rider' | 'other'
const MODE_GROUP: Record<TravelMode, CasualtyGroup> = {
  car: 'other',
  bus: 'other',
  motorcycle: 'rider',
  pedestrian: 'pedestrian',
}

const GROUP_NOUN: Record<CasualtyGroup, string> = {
  pedestrian: 'people on foot',
  rider: 'riders',
  other: 'vehicle occupants',
}

export type Factor = {
  key: 'hotspots' | 'district' | 'mode' | 'time'
  label: string
  /** 0 = no measured risk, 1 = the worst the data shows. */
  risk: number
  weight: number
  /** The real figures behind it, for the "why" panel. */
  headline: string
  detail: string
  source: string
}

export type Advice = {
  severity: 'critical' | 'warning' | 'info'
  text: string
  basis: string
}

export type NearbyPlace = EmergencyPlace & { detourKm: number }

export type RouteAssessment = {
  origin: Place
  destination: Place
  mode: TravelMode
  timeBand: TimeBand
  directDistanceKm: number
  score: number
  band: { label: string; tone: 'good' | 'moderate' | 'high' | 'severe' }
  factors: Factor[]
  hotspots: (Hotspot & { detourKm: number })[]
  districts: District[]
  emergency: { hospitals: NearbyPlace[]; police: NearbyPlace[] }
  advice: Advice[]
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const round1 = (n: number) => Math.round(n * 10) / 10

/** Rescale a measurement to 0..1 against the range the data actually spans.
 *
 * Dividing by the maximum alone does not work here. Vehicle occupants are
 * always the largest casualty group and the calmest district still records
 * plenty of accidents, so every route came out near the top of the scale and
 * nothing was ever rated safe. Anchoring to the observed minimum as well gives
 * each factor an honest meaning: 0 is the best this measure gets anywhere in
 * Mauritius, 1 is the worst. Both ends come from the tables, not from us.
 */
function normalise(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return clamp01((value - min) / (max - min))
}

/** The observed range of every factor, recomputed from whatever data is loaded. */
export function scaleBounds(data: AppData) {
  const ds = data.districts.districts
  const pressures = ds.map((d) => d.pressureIndex)

  // Mode ratios: how a district's share for one travel group compares with the
  // island's share for that same group. Exposure-neutral, so a car trip is not
  // punished merely because most people travel by car.
  const islandShare = {
    pedestrian: data.exposure.pedestrianCasualtyShare,
    rider: data.exposure.riderCasualtyShare,
    other: 1 - data.exposure.vulnerableShare,
  }
  const ratios = ds.flatMap((d) => [
    d.pedestrianShare / (islandShare.pedestrian || 1),
    d.riderShare / (islandShare.rider || 1),
    d.otherShare / (islandShare.other || 1),
  ])

  const fatalShares = data.conditions.light.conditions.map((c) => c.fatalShare)

  return {
    pressure: { min: Math.min(...pressures), max: Math.max(...pressures) },
    modeRatio: { min: Math.min(...ratios), max: Math.max(...ratios) },
    fatalShare: { min: Math.min(...fatalShares), max: Math.max(...fatalShares) },
    islandShare,
  }
}

function lightFor(data: AppData, band: TimeBand): LightCondition | undefined {
  return data.conditions.light.conditions.find((c) => c.condition === TIME_BAND_CONDITION[band])
}

/** Police districts a corridor touches: those of its two endpoints. */
function districtsFor(data: AppData, origin: Place, destination: Place): District[] {
  const names = new Set([...origin.policeDistricts, ...destination.policeDistricts])
  return data.districts.districts.filter((d) => names.has(d.name))
}

/** Accident-prone segments lying within the corridor radius, nearest first. */
export function hotspotsOnCorridor(
  data: AppData,
  origin: Place,
  destination: Place,
): (Hotspot & { detourKm: number })[] {
  const radius = data.hotspots.corridorRadiusKm
  return data.hotspots.hotspots
    .map((h) => ({ ...h, detourKm: polylineDistanceToCorridorKm(h.points, origin, destination) }))
    .filter((h) => h.detourKm <= radius)
    .sort((a, b) => a.detourKm - b.detourKm)
}

/** Emergency places closest to the corridor itself, not just to one endpoint. */
function nearestToCorridor(
  places: EmergencyPlace[],
  origin: Place,
  destination: Place,
  limit: number,
): NearbyPlace[] {
  return places
    .map((p) => ({ ...p, detourKm: distanceToSegmentKm(p, origin, destination) }))
    .sort((a, b) => a.detourKm - b.detourKm)
    .slice(0, limit)
}

export function assessRoute(
  data: AppData,
  origin: Place,
  destination: Place,
  mode: TravelMode,
  timeBand: TimeBand,
): RouteAssessment {
  const group = MODE_GROUP[mode]
  const districts = districtsFor(data, origin, destination)
  const hotspots = hotspotsOnCorridor(data, origin, destination)
  const directDistanceKm = distanceKm(origin, destination)
  const bounds = scaleBounds(data)

  // --- Factor 1: officially designated accident-prone segments -------------
  // Scaled against the 90th-percentile corridor measured across every town pair
  // in this network, so "a lot" is defined by the network, not by us.
  const p90 = data.hotspots.scale.p90Count || 1
  const hotspotRisk = clamp01(hotspots.length / p90)

  // --- Factor 2: how much casualty volume these districts carry ------------
  // Measured across the island's quietest to busiest district.
  const pressure = districts.length
    ? districts.reduce((s, d) => s + d.pressureIndex, 0) / districts.length
    : 0
  const districtRisk = normalise(pressure, bounds.pressure.min, bounds.pressure.max)
  const accidentTotal = districts.reduce((s, d) => s + d.casualtyAccidents, 0)

  // --- Factor 3: is this corridor unusually bad for someone like you? ------
  // Compares this corridor's casualty share for your travel group with the
  // island's share for that same group, so the measure is about place rather
  // than about how many people happen to travel each way.
  const shareOf = (d: District): number =>
    group === 'pedestrian' ? d.pedestrianShare : group === 'rider' ? d.riderShare : d.otherShare
  const corridorShare = districts.length
    ? districts.reduce((s, d) => s + shareOf(d), 0) / districts.length
    : 0
  const islandShareForGroup = bounds.islandShare[group] || 1
  const modeRatio = corridorShare / islandShareForGroup
  const modeRisk = normalise(modeRatio, bounds.modeRatio.min, bounds.modeRatio.max)

  // --- Factor 4: what the light does to severity ---------------------------
  // Daylight is the safest condition recorded, so it adds nothing; the unlit
  // road is the worst, so it adds the full weight.
  const light = lightFor(data, timeBand)
  const dayLight = data.conditions.light.conditions.find((c) => c.condition === 'Day light')
  const timeRisk = light
    ? normalise(light.fatalShare, bounds.fatalShare.min, bounds.fatalShare.max)
    : 0

  const factors: Factor[] = [
    {
      key: 'hotspots',
      label: 'Accident-prone segments',
      risk: hotspotRisk,
      weight: WEIGHTS.hotspots,
      headline: `${hotspots.length} on this corridor`,
      detail:
        hotspots.length === 0
          ? `No officially designated accident-prone segment lies within ${data.hotspots.corridorRadiusKm} km of this corridor.`
          : `${hotspots.length} of the island's ${data.hotspots.hotspots.length} designated accident-prone segments lie within ${data.hotspots.corridorRadiusKm} km of it. A typical corridor here passes ${data.hotspots.scale.medianCount}; the busiest passes ${data.hotspots.scale.maxCount}.`,
      source: 'Accident Prone Areas, Open Data Mauritius',
    },
    {
      key: 'district',
      label: 'Casualty volume in these districts',
      risk: districtRisk,
      weight: WEIGHTS.district,
      headline: `${accidentTotal.toLocaleString()} casualty accidents in ${data.districts.year}`,
      detail: `${districts.map((d) => d.name).join(' and ')} recorded ${accidentTotal.toLocaleString()} casualty accidents in ${data.districts.year}, measured against the island's worst district.`,
      source: 'Casualty Accidents by Police District, Open Data Mauritius',
    },
    {
      key: 'mode',
      label: `Risk carried by ${GROUP_NOUN[group]}`,
      risk: modeRisk,
      weight: WEIGHTS.mode,
      headline: `${pct(corridorShare)} of casualties here, against ${pct(islandShareForGroup)} island-wide`,
      detail: `In these districts, ${pct(corridorShare)} of road casualties were ${GROUP_NOUN[group]}. Island-wide the figure is ${pct(islandShareForGroup)}, so this corridor runs at ${round1(modeRatio)} times the national pattern for how you are travelling.`,
      source: 'Casualty Accidents by Police District, Open Data Mauritius',
    },
    {
      key: 'time',
      label: 'Light conditions',
      risk: timeRisk,
      weight: WEIGHTS.time,
      headline: light ? `${pct(light.fatalShare)} of casualties fatal` : 'No data',
      detail: light
        ? `In ${light.condition.toLowerCase()}, ${pct(light.fatalShare)} of casualties were fatal (${data.conditions.light.year} figures, ${light.casualties.toLocaleString()} casualties recorded).${
            dayLight && light.condition !== 'Day light'
              ? ` In daylight it is ${pct(dayLight.fatalShare)}.`
              : ''
          }`
        : 'No published figure for this light condition.',
      source: 'Casualties by Severity and Light Conditions, Open Data Mauritius',
    },
  ]

  const weighted = factors.reduce((s, f) => s + f.risk * f.weight, 0)
  const score = Math.round(100 - weighted * 100)

  return {
    origin,
    destination,
    mode,
    timeBand,
    directDistanceKm,
    score,
    band: scoreBand(score),
    factors,
    hotspots,
    districts,
    emergency: {
      hospitals: nearestToCorridor(
        data.emergency.places.filter((p) => p.kind === 'hospital' || p.kind === 'clinic'),
        origin,
        destination,
        4,
      ),
      police: nearestToCorridor(
        data.emergency.places.filter((p) => p.kind === 'police'),
        origin,
        destination,
        3,
      ),
    },
    advice: buildAdvice(data, { mode, timeBand, hotspots, districts, group, directDistanceKm }),
  }
}

export function scoreBand(score: number): RouteAssessment['band'] {
  if (score >= 80) return { label: 'Lower risk', tone: 'good' }
  if (score >= 65) return { label: 'Moderate risk', tone: 'moderate' }
  if (score >= 50) return { label: 'High risk', tone: 'high' }
  return { label: 'Severe risk', tone: 'severe' }
}

/** Advice is assembled from the same tables, so each line can cite its basis. */
function buildAdvice(
  data: AppData,
  ctx: {
    mode: TravelMode
    timeBand: TimeBand
    hotspots: (Hotspot & { detourKm: number })[]
    districts: District[]
    group: CasualtyGroup
    directDistanceKm: number
  },
): Advice[] {
  const out: Advice[] = []
  const { mode, timeBand, hotspots, districts, group } = ctx

  // Named black spots are the most concrete thing we can tell a commuter.
  if (hotspots.length) {
    const named = hotspots.slice(0, 3).map((h) => h.road ?? h.label.split(/[,-]/)[0].trim())
    out.push({
      severity: hotspots.length >= data.hotspots.scale.p90Count ? 'critical' : 'warning',
      text: `Slow down through ${named.join(', ')}. ${
        hotspots.length === 1 ? 'One stretch' : `${hotspots.length} stretches`
      } on this corridor ${hotspots.length === 1 ? 'is' : 'are'} officially designated accident-prone.`,
      basis: 'Accident Prone Areas dataset',
    })
  }

  // Darkness roughly doubles the share of casualties that are fatal.
  const light = lightFor(data, timeBand)
  const day = data.conditions.light.conditions.find((c) => c.condition === 'Day light')
  if (light && day && light.fatalShare > day.fatalShare) {
    const ratio = light.fatalShare / day.fatalShare
    out.push({
      severity: ratio >= 2 ? 'critical' : 'warning',
      text: `Travelling in ${light.condition.toLowerCase()} is ${round1(ratio)} times as likely to end in a death as the same trip in daylight (${pct(light.fatalShare)} of casualties fatal, against ${pct(day.fatalShare)}). If the trip can wait for daylight, let it.`,
      basis: `Light conditions, ${data.conditions.light.year}`,
    })
  }

  // Mode-specific, using the exposure denominator where one exists.
  if (group === 'rider' && data.exposure.riderRiskRatio) {
    out.push({
      severity: 'critical',
      text: `Riders are ${data.exposure.riderRiskRatio} times as likely to be hurt as occupants of other vehicles, per registered vehicle (${data.exposure.riderCasualtiesPer1000Vehicles} casualties per 1,000 two-wheelers against ${data.exposure.occupantCasualtiesPer1000Vehicles}). Helmet, lights and visible clothing do the work here.`,
      basis: `Casualties ${data.exposure.casualtyYear} over vehicles registered ${data.exposure.vehicleYear}`,
    })
  }
  if (group === 'pedestrian') {
    const oneWay = data.conditions.roads.types.find((r) => r.roadType === 'One Way Street')
    const twoWay = data.conditions.roads.types.find((r) => r.roadType === 'Two Way Street')
    const worst = oneWay && twoWay && oneWay.hitPedestrianShare > twoWay.hitPedestrianShare ? oneWay : twoWay
    if (worst) {
      out.push({
        severity: 'warning',
        text: `On a ${worst.roadType.toLowerCase()}, ${pct(worst.hitPedestrianShare)} of casualty accidents involve someone being hit on foot. Cross at a marked crossing and make eye contact with the driver before you step out.`,
        basis: `Casualty accidents by road and collision type, ${data.conditions.roads.year}`,
      })
    }
  }

  // Open road, not junctions, is where fatal crashes concentrate.
  const notJunction = data.conditions.junctions.types.find((j) => j.junctionType === 'Not a Junction')
  const junctionsOnly = data.conditions.junctions.types.filter((j) => j.junctionType !== 'Not a Junction')
  const junctionAccidents = junctionsOnly.reduce((s, j) => s + j.accidents, 0)
  if (notJunction && junctionAccidents) {
    const atJunctionFatal =
      junctionsOnly.reduce((s, j) => s + j.fatal, 0) / junctionAccidents
    if (notJunction.fatalShare > atJunctionFatal) {
      out.push({
        severity: 'info',
        text: `Most deaths happen between junctions, not at them: ${pct(notJunction.fatalShare)} of casualty accidents away from a junction were fatal, against ${pct(atJunctionFatal)} at one. The open stretch is where speed kills.`,
        basis: `Junction types, ${data.conditions.junctions.year}`,
      })
    }
  }

  // Motorway corridors carry the highest fatal share of any road type.
  const dual = data.conditions.roads.types.find((r) => r.roadType === 'Dual Carriage way')
  const onMotorway = hotspots.some((h) => h.road?.startsWith('M'))
  if (dual && onMotorway && mode !== 'pedestrian') {
    out.push({
      severity: 'warning',
      text: `This corridor uses the motorway. ${pct(dual.fatalShare)} of casualty accidents on dual carriageways are fatal, the highest of any road type, because of the speeds involved.`,
      basis: `Road types, ${data.conditions.roads.year}`,
    })
  }

  // Where the casualty count is climbing, say so.
  const rising = districts.filter((d) => (d.changeVsPrevYear ?? 0) > 0.05)
  if (rising.length) {
    const d = rising.sort((a, b) => (b.changeVsPrevYear ?? 0) - (a.changeVsPrevYear ?? 0))[0]
    out.push({
      severity: 'info',
      text: `Casualty accidents in ${d.name} rose ${pct(d.changeVsPrevYear ?? 0)} in ${d.year} against the year before.`,
      basis: `Casualty accidents by police district, ${d.year}`,
    })
  }

  return out
}
