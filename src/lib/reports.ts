/** Hazard reports from other riders, read and written through /api/reports.
 *
 * People on the road are the sensor. Someone who has just passed a crash knows
 * before any feed does, and the rider behind them is the person who needs it.
 */

import { API_BASE } from './platform'

/** The kinds a rider picks from a list. */
export const REPORT_KINDS = ['crash', 'blocked', 'flood', 'hazard', 'police'] as const

/** Every kind the API accepts. 'pothole' is not in the picker above because
 *  nobody taps it: the Android road scanner writes it from a jolt the phone
 *  felt. Putting it in the list would offer a rider a button for the one
 *  thing the app does without them. */
export const ALL_REPORT_KINDS = [...REPORT_KINDS, 'pothole'] as const
export type ReportKind = (typeof ALL_REPORT_KINDS)[number]

export type HazardReport = {
  id: string
  kind: ReportKind
  lat: number
  lon: number
  note: string
  at: string
  /** Added by the API when the request carried a location. */
  distanceKm?: number
}

export const REPORT_LABEL: Record<ReportKind, string> = {
  crash: 'Crash',
  blocked: 'Road blocked',
  flood: 'Flooding',
  hazard: 'Hazard on road',
  police: 'Police check',
  pothole: 'Pothole jolt',
}

export const REPORT_DESCRIPTION: Record<ReportKind, string> = {
  crash: 'A collision, with people possibly hurt',
  blocked: 'Closed, or traffic at a standstill',
  flood: 'Standing water across the road',
  hazard: 'Debris, an animal, a missing cover',
  police: 'A checkpoint or speed check',
  pothole: 'A jolt a phone logged while moving',
}

/** Ordered by how much the rider behind needs to know. */
export const REPORT_SEVERITY: Record<ReportKind, 'critical' | 'warning' | 'info'> = {
  crash: 'critical',
  flood: 'critical',
  blocked: 'warning',
  hazard: 'warning',
  police: 'info',
  // One jolt is one phone's bump and nothing more. It becomes something a
  // rider should act on only once three of them land within fifty metres,
  // and that is said on the road scanner screen, not in this feed.
  pothole: 'info',
}

export async function fetchReports(
  lat: number,
  lon: number,
  radiusKm: number,
  signal?: AbortSignal,
): Promise<HazardReport[]> {
  const qs = new URLSearchParams({ lat: String(lat), lon: String(lon), km: String(radiusKm) })
  const res = await fetch(`${API_BASE}/api/reports?${qs}`, { signal })
  if (!res.ok) throw new Error(`reports ${res.status}`)
  const body = (await res.json()) as { reports: HazardReport[] }
  return body.reports ?? []
}

export async function submitReport(input: {
  kind: ReportKind
  lat: number
  lon: number
  note: string
}): Promise<HazardReport> {
  const res = await fetch(`${API_BASE}/api/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = (await res.json()) as { report?: HazardReport; error?: string }
  if (!res.ok || !body.report) throw new Error(body.error ?? `reports ${res.status}`)
  return body.report
}

/** "11 minutes ago", for a feed where age is the whole point. */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins === 1) return '1 minute ago'
  if (mins < 60) return `${mins} minutes ago`
  const hours = Math.round(mins / 60)
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`
}
