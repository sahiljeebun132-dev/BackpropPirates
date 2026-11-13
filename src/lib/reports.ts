/** Hazard reports from other riders, read and written through /api/reports.
 *
 * People on the road are the sensor. Someone who has just passed a crash knows
 * before any feed does, and the rider behind them is the person who needs it.
 */

export const REPORT_KINDS = ['crash', 'blocked', 'flood', 'hazard', 'police'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

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
}

export const REPORT_DESCRIPTION: Record<ReportKind, string> = {
  crash: 'A collision, with people possibly hurt',
  blocked: 'Closed, or traffic at a standstill',
  flood: 'Standing water across the road',
  hazard: 'Debris, an animal, a missing cover',
  police: 'A checkpoint or speed check',
}

/** Ordered by how much the rider behind needs to know. */
export const REPORT_SEVERITY: Record<ReportKind, 'critical' | 'warning' | 'info'> = {
  crash: 'critical',
  flood: 'critical',
  blocked: 'warning',
  hazard: 'warning',
  police: 'info',
}

export async function fetchReports(
  lat: number,
  lon: number,
  radiusKm: number,
  signal?: AbortSignal,
): Promise<HazardReport[]> {
  const qs = new URLSearchParams({ lat: String(lat), lon: String(lon), km: String(radiusKm) })
  const res = await fetch(`/api/reports?${qs}`, { signal })
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
  const res = await fetch('/api/reports', {
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
