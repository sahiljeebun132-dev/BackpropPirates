/** Turning single jolts into road defects, with arithmetic anyone can check.
 *
 * One phone reporting a bang says nothing. It could be a drain cover, a bad
 * mount, a bag dropped in the footwell, or a rider who took a kerb. Three
 * phones reporting a bang in the same fifty metres is a hole in the road.
 *
 * That is the whole rule, and it is deliberately arithmetic rather than a
 * model. A maintenance crew being sent somewhere deserves to be told exactly
 * why, and "three reports fell within fifty metres of each other" is a
 * sentence the Road Development Authority can check against its own records.
 * Nothing here is learned, weighted or tuned, so nothing here can quietly
 * drift. Every figure a screen shows about a cluster is counted from the
 * reports below it.
 *
 * Grouping is by distance to the cluster's centre, not to its nearest member.
 * Single-link chaining would be easier and wrong: potholes come in runs, and
 * a line of them forty metres apart would collapse into one "defect" four
 * hundred metres long that names no particular place. Fifty metres around a
 * centre stays the size of a thing a crew can stand next to.
 */

/** How close two reports must be to describe the same defect, in metres.
 *  Wider than a GPS fix is wrong by on an open road, narrower than the gap
 *  between two separate holes. */
export const CLUSTER_RADIUS_M = 50

/** Reports needed before a cluster is called a road defect rather than one
 *  person's bump. Three is the smallest number that cannot be one rider
 *  hitting the same spot twice and a phone that double-fired. */
export const VERIFIED_MIN_REPORTS = 3

/** The g the Android service fires at. Repeated here only so the exported
 *  summary can say what the threshold was; the service owns the real one. */
export const JOLT_THRESHOLD_G = 2.2

export type PotholeReport = {
  id: string
  lat: number
  lon: number
  /** ISO 8601, as the reports API stores it. */
  at: string
}

export type PotholeCluster = {
  /** The id of the earliest report in the cluster, so a cluster keeps the
   *  same name between refreshes as long as that report is still in range. */
  id: string
  /** Mean position of the members. Reported to 5 decimals, which is the
   *  precision the reports API stores and about a metre on the ground. */
  lat: number
  lon: number
  count: number
  firstSeen: string
  lastSeen: string
  /** count >= VERIFIED_MIN_REPORTS. Nothing else feeds this. */
  verified: boolean
  reportIds: string[]
}

const M_PER_DEG_LAT = 110_574

/** Metres per degree of longitude at a given latitude. Mauritius is narrow
 *  enough that the fixed value used elsewhere in the app is fine for corridor
 *  maths, but fifty metres is a tighter question than eight kilometres, so
 *  this one uses the actual latitude. */
const mPerDegLon = (lat: number): number => 111_320 * Math.cos((lat * Math.PI) / 180)

/** Straight-line distance in metres. Equirectangular: over fifty metres the
 *  difference from the great circle is far below the error in the fix. */
export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const midLat = (a.lat + b.lat) / 2
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lon - b.lon) * mPerDegLon(midLat))
}

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5

/**
 * Group reports into clusters, oldest first.
 *
 * Oldest first because it makes the result independent of the order the API
 * happened to return things in: the same set of reports always produces the
 * same clusters with the same ids. A report joins the nearest cluster whose
 * centre is within the radius, and the centre is the running mean of its
 * members, so a cluster drifts towards where the reports actually are rather
 * than staying pinned to whichever one arrived first.
 */
export function clusterPotholes(
  reports: PotholeReport[],
  radiusM: number = CLUSTER_RADIUS_M,
  minReports: number = VERIFIED_MIN_REPORTS,
): PotholeCluster[] {
  const ordered = [...reports].sort((a, b) => {
    const byTime = Date.parse(a.at) - Date.parse(b.at)
    // Two reports in the same millisecond still have to order the same way
    // every run, or two refreshes could disagree about a cluster's id.
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })

  type Working = { lat: number; lon: number; members: PotholeReport[] }
  const working: Working[] = []

  for (const report of ordered) {
    let nearest: Working | null = null
    let nearestM = Infinity
    for (const cluster of working) {
      const d = metresBetween(report, cluster)
      if (d <= radiusM && d < nearestM) {
        nearest = cluster
        nearestM = d
      }
    }

    if (!nearest) {
      working.push({ lat: report.lat, lon: report.lon, members: [report] })
      continue
    }

    nearest.members.push(report)
    const n = nearest.members.length
    nearest.lat += (report.lat - nearest.lat) / n
    nearest.lon += (report.lon - nearest.lon) / n
  }

  return working
    .map((c) => {
      // The members arrived in time order, so the ends of the list are the
      // first and last sighting without sorting again.
      const first = c.members[0]
      const last = c.members[c.members.length - 1]
      return {
        id: first.id,
        lat: round5(c.lat),
        lon: round5(c.lon),
        count: c.members.length,
        firstSeen: first.at,
        lastSeen: last.at,
        verified: c.members.length >= minReports,
        reportIds: c.members.map((m) => m.id),
      }
    })
    .sort(
      (a, b) =>
        // Worst first: what a crew would work through in order.
        Number(b.verified) - Number(a.verified) ||
        b.count - a.count ||
        Date.parse(b.lastSeen) - Date.parse(a.lastSeen) ||
        a.id.localeCompare(b.id),
    )
}

/** "2026-11-14 07:55 UTC". Not a locale format: this text is meant to be
 *  pasted into an email to an authority, where an unambiguous timestamp is
 *  worth more than a friendly one. */
function stamp(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unknown'
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * The plain-text summary a rider can send on.
 *
 * It states the method and the thresholds before the list, because a reading
 * taken by a phone in a pocket is evidence of a jolt and not a survey, and
 * whoever receives this should be able to judge it. It does not claim
 * anything has been filed with anyone: producing the text is all this does,
 * and sending it is the rider's decision and the rider's act.
 */
export function maintenanceSummary(
  clusters: PotholeCluster[],
  generatedAt: Date = new Date(),
): string {
  const verified = clusters.filter((c) => c.verified)
  const unverified = clusters.filter((c) => !c.verified)

  const line = (c: PotholeCluster, i: number): string =>
    `${String(i + 1).padStart(2)}. ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}` +
    `  ${String(c.count).padStart(2)} report${c.count === 1 ? ' ' : 's'}` +
    `  first ${stamp(c.firstSeen)}  last ${stamp(c.lastSeen)}`

  const out: string[] = [
    'ROAD SURFACE LOG — Zetway',
    `Generated ${stamp(generatedAt.toISOString())}`,
    '',
    'How these points were produced',
    `  A phone carried by a rider logged a vertical jolt over ${JOLT_THRESHOLD_G.toFixed(1)} g`,
    '  while the vehicle was moving. Points within ' + `${CLUSTER_RADIUS_M} m of each other are`,
    '  grouped. A group holding ' + `${VERIFIED_MIN_REPORTS} or more separate reports is listed`,
    '  below as a verified defect; anything with fewer is listed as an',
    '  unverified jolt and may be a drain cover, a kerb or a loose mount.',
    '  Positions are WGS84 decimal degrees, from the phone’s own GPS.',
    '',
    'This log has not been submitted to the Road Development Authority or to',
    'anyone else. It was produced on the rider’s phone for them to send on.',
    '',
    `VERIFIED ROAD DEFECTS (${verified.length})`,
  ]

  out.push(
    ...(verified.length
      ? verified.map(line)
      : ['  None. No group has reached ' + `${VERIFIED_MIN_REPORTS} reports yet.`]),
  )
  out.push('', `UNVERIFIED JOLTS (${unverified.length})`)
  out.push(...(unverified.length ? unverified.map(line) : ['  None.']))

  const reports = clusters.reduce((t, c) => t + c.count, 0)
  out.push(
    '',
    `${reports} report${reports === 1 ? '' : 's'} in ${clusters.length} ` +
      `group${clusters.length === 1 ? '' : 's'}.`,
  )

  return out.join('\n')
}
