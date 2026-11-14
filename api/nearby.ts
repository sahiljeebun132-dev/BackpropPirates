/** Riders on the road near you, right now.
 *
 *   POST /api/nearby  {id, lat, lon}   I am here; who else is?
 *   GET  /api/nearby?lat=&lon=&km=     who else is, without saying where I am
 *
 * This is the most privacy-sensitive route in an app whose whole argument is
 * that it asks for nothing, so it is built to hand back as little as it can
 * while still being worth drawing.
 *
 *   No identity. The id is a random string the phone makes for one session
 *   and discards. It is not the install id and cannot be joined to a hazard
 *   report, a crash, or a previous session.
 *
 *   Coarse. The client rounds before sending and this route rounds again, to
 *   three decimals — about a hundred metres here. You learn that somebody is
 *   on your road. You do not learn which bike, and you could not follow one.
 *
 *   Brief. Nothing older than two minutes is returned, and old rows are
 *   deleted on write rather than left for a cron that might not run. There is
 *   no history here because none is kept.
 *
 *   Opt-in. Nothing reaches this route unless the rider switched it on, and
 *   the screen says all of the above first.
 *
 * What it deliberately does NOT do: return ids, timestamps, headings, speeds
 * or counts per rider. A caller gets points and nothing else, because points
 * are all a map needs and everything else is a way to follow somebody.
 */

/** Public anon key; row-level security is what constrains it. */
const SUPABASE_URL = 'https://lhfonctjtiediylfjscd.supabase.co'
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoZm9uY3RqdGllZGl5bGZqc2NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzc0MDcsImV4cCI6MjEwMTg1MzQwN30.XzgVXT8DbjjocWLXvAtXc2p8F0t0nb6G9OjL_UDE74s'

const REST = `${SUPABASE_URL}/rest/v1`
const TABLE = 'zetway_presence'
const AUTH = {
  apikey: SUPABASE_ANON,
  authorization: `Bearer ${SUPABASE_ANON}`,
  'content-type': 'application/json',
}

/** A rider who has not checked in for two minutes has stopped, parked, or
 *  closed the app. Showing them would be showing a ghost. */
const TTL_SECONDS = 120
const DEFAULT_RADIUS_KM = 5
const MAX_RADIUS_KM = 25
const MAX_RETURNED = 60

const KM_PER_DEG_LAT = 110.57
const KM_PER_DEG_LON = 111.32 * Math.cos((20.3 * Math.PI) / 180)

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  })

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

function inMauritius(lat: number, lon: number): boolean {
  return lat > -20.9 && lat < -19.8 && lon > 57.1 && lon < 57.9
}

/** Three decimals. The client already rounds; this is the backstop, because
 *  a promise the server does not enforce is a promise about the client. */
const coarse = (n: number): number => Math.round(n * 1000) / 1000

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return Math.hypot((aLat - bLat) * KM_PER_DEG_LAT, (aLon - bLon) * KM_PER_DEG_LON)
}

type Row = { id: string; lat: number; lon: number; at: string }

async function fresh(): Promise<Row[]> {
  const cutoff = new Date(Date.now() - TTL_SECONDS * 1000).toISOString()
  const res = await fetch(
    `${REST}/${TABLE}?at=gte.${encodeURIComponent(cutoff)}&select=id,lat,lon,at&limit=400`,
    { headers: AUTH, cache: 'no-store' },
  )
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return (await res.json()) as Row[]
}

/** Points near a place, with the caller's own row removed. Returns bare
 *  coordinate pairs: no ids, no times, nothing to follow anybody by. */
function near(rows: Row[], lat: number, lon: number, km: number, selfId: string | null) {
  return rows
    .filter((r) => r.id !== selfId)
    .map((r) => ({ r, d: distanceKm(lat, lon, r.lat, r.lon) }))
    .filter((x) => x.d <= km)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_RETURNED)
    .map((x) => [coarse(x.r.lat), coarse(x.r.lon)] as [number, number])
}

/** Delete anything past its life. Done on write so the table cannot grow a
 *  history while nobody is looking. */
async function expire(): Promise<void> {
  const cutoff = new Date(Date.now() - TTL_SECONDS * 1000).toISOString()
  await fetch(`${REST}/${TABLE}?at=lt.${encodeURIComponent(cutoff)}`, {
    method: 'DELETE',
    headers: { ...AUTH, prefer: 'return=minimal' },
  })
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  const km = Math.min(MAX_RADIUS_KM, Number(url.searchParams.get('km')) || DEFAULT_RADIUS_KM)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'lat and lon are required' }, 400)
  }

  try {
    const rows = await fresh()
    return json({ riders: near(rows, lat, lon, km, null), ttlSeconds: TTL_SECONDS })
  } catch (err) {
    console.error('nearby read failed', err)
    return json({ error: 'could not read nearby riders', detail: String(err) }, 502)
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'body must be JSON' }, 400)
  }

  const id = String(body.id ?? '').slice(0, 40)
  const lat = Number(body.lat)
  const lon = Number(body.lon)
  const km = Math.min(MAX_RADIUS_KM, Number(body.km) || DEFAULT_RADIUS_KM)

  if (!id) return json({ error: 'a session id is required' }, 400)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inMauritius(lat, lon)) {
    return json({ error: 'coordinates must be inside Mauritius' }, 400)
  }

  const point = { id, lat: coarse(lat), lon: coarse(lon), at: new Date().toISOString() }

  try {
    const res = await fetch(`${REST}/${TABLE}`, {
      method: 'POST',
      headers: { ...AUTH, prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(point),
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)

    // Tidy while we are here, so expiry never depends on a scheduled job.
    void expire()

    const rows = await fresh()
    return json({ riders: near(rows, lat, lon, km, id), ttlSeconds: TTL_SECONDS })
  } catch (err) {
    console.error('nearby write failed', err)
    return json({ error: 'could not share your position', detail: String(err) }, 502)
  }
}

/** Housekeeping, callable by hand. */
export async function DELETE(): Promise<Response> {
  try {
    await expire()
    return json({ ok: true })
  } catch (err) {
    return json({ error: 'could not expire', detail: String(err) }, 502)
  }
}
