/** Hazard reports from riders, shared live between everyone using the app.
 *
 * This is the honest version of "detect incidents automatically": people on
 * the road are the sensor. A rider who has just passed a crash knows more than
 * any satellite could, and knows it immediately.
 *
 *   GET  /api/reports?lat=&lon=&km=   recent reports near a point
 *   POST /api/reports                 add one
 *
 * Storage is Postgres, one row per report, so two people reporting at the
 * same moment cannot overwrite each other. This began life on a private
 * Vercel Blob store; that store was suspended at the account level hours
 * before a live demonstration, which took hazard reporting down in
 * production with it. The validation, the four-hour expiry and the shape of
 * the responses are unchanged — only the shelf the rows sit on moved.
 *
 * The browser still only ever talks to this function, which decides what may
 * be written.
 */

/** The project's public anon key. It is designed to ship in client bundles
 *  and is safe in source; what constrains it is row-level security on a table
 *  that holds nothing but public hazard warnings, each of which expires. */
const SUPABASE_URL = 'https://lhfonctjtiediylfjscd.supabase.co'
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoZm9uY3RqdGllZGl5bGZqc2NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzc0MDcsImV4cCI6MjEwMTg1MzQwN30.XzgVXT8DbjjocWLXvAtXc2p8F0t0nb6G9OjL_UDE74s'

const REST = `${SUPABASE_URL}/rest/v1`
const TABLE = 'zetway_reports'
const AUTH = {
  apikey: SUPABASE_ANON,
  authorization: `Bearer ${SUPABASE_ANON}`,
  'content-type': 'application/json',
}
/** Reports older than this stop being useful to someone setting off now. */
const TTL_MINUTES = 240
/** Most recent N fetched per request, so a flood cannot slow the app down. */
const MAX_READ = 80
const MAX_NOTE = 140
const DEFAULT_RADIUS_KM = 8

/** Kinds a rider can report. Anything else is rejected.
 *
 *  'pothole' is the one nobody taps: the Android scanner writes it when the
 *  phone takes a vertical jolt while moving, because a rider cannot report a
 *  hole in the road while steering over it. It is stored and expired exactly
 *  like the rest — this route knows nothing about clustering, and the
 *  promotion from "one jolt" to "road defect" happens in the app from the
 *  reports this route already returns. */
const KINDS = ['crash', 'blocked', 'flood', 'hazard', 'police', 'pothole'] as const
type Kind = (typeof KINDS)[number]

type StoredReport = {
  id: string
  kind: Kind
  lat: number
  lon: number
  note: string
  at: string
}

const KM_PER_DEG_LAT = 110.57
const KM_PER_DEG_LON = 111.32 * Math.cos((20.3 * Math.PI) / 180)

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return Math.hypot((aLat - bLat) * KM_PER_DEG_LAT, (aLon - bLon) * KM_PER_DEG_LON)
}

/** The Android build is served from the APK, so its page origin is
 *  `https://localhost` and every call to this function is cross-origin. The
 *  web build shares an origin with it and needs none of this.
 *
 *  `*` is the honest value rather than a lax one. There are no cookies and no
 *  credentials here, so a narrower origin list would protect nothing: CORS
 *  only constrains browsers, and anything that is not a browser can call this
 *  function regardless. What actually guards the store is the validation
 *  below — the kind must be known, the point must be inside Mauritius, the
 *  note is truncated, and reports expire. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Reports are the one thing that must never be served stale.
      'cache-control': 'no-store',
      ...CORS,
    },
  })

/** Preflight. A POST carrying JSON always triggers one. */
export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

/** Mauritius plus its lagoon, generously. Keeps junk out of the store. */
function inMauritius(lat: number, lon: number): boolean {
  return lat > -20.9 && lat < -19.8 && lon > 57.1 && lon < 57.9
}

function parseReport(pathname: string, text: string): StoredReport | null {
  try {
    const r = JSON.parse(text) as StoredReport
    if (!KINDS.includes(r.kind) || typeof r.lat !== 'number' || typeof r.lon !== 'number') {
      return null
    }
    return r
  } catch {
    console.error('unreadable report blob', pathname)
    return null
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  const radiusKm = Number(url.searchParams.get('km')) || DEFAULT_RADIUS_KM
  const filterByPlace = Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0

  try {
    // One query, filtered and capped by the database. Expiry is a WHERE
    // clause rather than a sweep, so a report stops being visible the moment
    // it is too old whether or not anything has tidied up after it.
    const cutoff = new Date(Date.now() - TTL_MINUTES * 60_000).toISOString()
    const res = await fetch(
      `${REST}/${TABLE}?at=gte.${encodeURIComponent(cutoff)}` +
        `&order=at.desc&limit=${MAX_READ}`,
      { headers: AUTH, cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)

    let reports = ((await res.json()) as unknown[])
      .map((row) => parseReport('row', JSON.stringify(row)))
      .filter((r): r is StoredReport => r !== null)
    if (filterByPlace) {
      reports = reports
        .map((r) => ({ ...r, distanceKm: Math.round(distanceKm(lat, lon, r.lat, r.lon) * 10) / 10 }))
        .filter((r) => r.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
    }

    return json({ reports, ttlMinutes: TTL_MINUTES })
  } catch (err) {
    console.error('list reports failed', err)
    return json({ error: 'could not read reports' }, 502)
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Partial<StoredReport>
  try {
    body = (await request.json()) as Partial<StoredReport>
  } catch {
    return json({ error: 'expected JSON' }, 400)
  }

  const kind = body.kind
  const lat = Number(body.lat)
  const lon = Number(body.lon)

  if (!kind || !KINDS.includes(kind)) {
    return json({ error: `kind must be one of ${KINDS.join(', ')}` }, 400)
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inMauritius(lat, lon)) {
    return json({ error: 'coordinates must be inside Mauritius' }, 400)
  }

  const report: StoredReport = {
    id: crypto.randomUUID(),
    kind,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    // Free text is trimmed hard: this is a hazard note, not a message board,
    // and it is shown to strangers.
    note: String(body.note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE),
    at: new Date().toISOString(),
  }

  try {
    const res = await fetch(`${REST}/${TABLE}`, {
      method: 'POST',
      headers: { ...AUTH, prefer: 'return=minimal' },
      body: JSON.stringify(report),
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return json({ report }, 201)
  } catch (err) {
    console.error('save report failed', err)
    return json({ error: 'could not save the report' }, 502)
  }
}

/** Housekeeping: drop anything past its usefulness.
 *
 *  Reads already exclude expired rows, so this only reclaims space and is
 *  safe to call at any time; it never touches anything inside the window. */
export async function DELETE(): Promise<Response> {
  try {
    const cutoff = new Date(Date.now() - TTL_MINUTES * 60_000).toISOString()
    const res = await fetch(`${REST}/${TABLE}?at=lt.${encodeURIComponent(cutoff)}`, {
      method: 'DELETE',
      headers: { ...AUTH, prefer: 'return=minimal' },
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return json({ ok: true })
  } catch (err) {
    console.error('expire reports failed', err)
    return json({ error: 'could not expire old reports' }, 502)
  }
}
