/** Hazard reports from riders, shared live between everyone using the app.
 *
 * This is the honest version of "detect incidents automatically": people on
 * the road are the sensor. A rider who has just passed a crash knows more than
 * any satellite could, and knows it immediately.
 *
 *   GET  /api/reports?lat=&lon=&km=   recent reports near a point
 *   POST /api/reports                 add one
 *
 * Storage is a private Vercel Blob store, one JSON object per report, so two
 * people reporting at the same moment cannot overwrite each other. Reads fetch
 * the objects in parallel and are capped, so one busy evening cannot turn a
 * page load into a hundred round trips.
 *
 * The store is private and the token never leaves the server: the browser only
 * ever talks to this function, which decides what may be written.
 */

import { del, get, list, put } from '@vercel/blob'

const PREFIX = 'reports/'
/** Reports older than this stop being useful to someone setting off now. */
const TTL_MINUTES = 240
/** Most recent N fetched per request, so a flood cannot slow the app down. */
const MAX_READ = 80
const MAX_NOTE = 140
const DEFAULT_RADIUS_KM = 8

/** Kinds a rider can report. Anything else is rejected. */
const KINDS = ['crash', 'blocked', 'flood', 'hazard', 'police'] as const
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

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Reports are the one thing that must never be served stale.
      'cache-control': 'no-store',
    },
  })

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
    const { blobs } = await list({ prefix: PREFIX, limit: 1000 })
    const cutoff = Date.now() - TTL_MINUTES * 60_000

    // Pathnames start with the timestamp, so sorting them sorts by age.
    const fresh = blobs
      .filter((b) => new Date(b.uploadedAt).getTime() >= cutoff)
      .sort((a, b) => b.pathname.localeCompare(a.pathname))
      .slice(0, MAX_READ)

    // The store is private, so blobs are read through the SDK with the
    // server's token rather than by fetching a URL.
    const settled = await Promise.all(
      fresh.map(async (b) => {
        try {
          const got = await get(b.pathname, { access: 'private' })
          if (!got || got.statusCode !== 200) return null
          return parseReport(b.pathname, await new Response(got.stream).text())
        } catch {
          return null // one unreadable report must not fail the whole feed
        }
      }),
    )

    let reports = settled.filter((r): r is StoredReport => r !== null)
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
    await put(`${PREFIX}${Date.now()}-${report.id}.json`, JSON.stringify(report), {
      access: 'private', // the store is private; only this function can read it
      contentType: 'application/json',
      addRandomSuffix: false,
    })
    return json({ report }, 201)
  } catch (err) {
    console.error('save report failed', err)
    return json({ error: 'could not save the report' }, 502)
  }
}

/** Housekeeping: drop anything past its usefulness. Safe to call from a cron
 *  or by hand; it never touches anything inside the window. */
export async function DELETE(): Promise<Response> {
  try {
    const { blobs } = await list({ prefix: PREFIX, limit: 1000 })
    const cutoff = Date.now() - TTL_MINUTES * 60_000
    const stale = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff)
    if (stale.length) await del(stale.map((b) => b.url))
    return json({ removed: stale.length })
  } catch (err) {
    console.error('cleanup failed', err)
    return json({ error: 'cleanup failed' }, 502)
  }
}
