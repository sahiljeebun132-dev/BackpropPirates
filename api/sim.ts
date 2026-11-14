/** The demo room: one laptop, one phone, and a row of judges watching.
 *
 * On stage nobody can crash a motorcycle, and shaking a phone hard enough to
 * clear 3g in front of an audience looks like a man shaking a phone. So this
 * is a room the phone joins and a laptop can fire into, and everything
 * downstream of the trigger is the real thing: the real sensor path, the real
 * countdown, real texts to real numbers, a real GPS fix.
 *
 *   GET  /api/sim?room=ABCD        the room as it stands
 *   POST /api/sim  {action, room}  join | trigger | alert | stand-down | reset
 *
 * Why a watch feed exists. The obvious demo is "every judge's phone rings",
 * and a phone cannot do that: one handset places one call at a time, which is
 * the carrier's rule and not something an app may argue with. The texts do go
 * to everyone at once, and they are the real artefact. This feed is what
 * makes it visible in a room — the judges open a page and the moment the
 * crash fires they get the alarm, the position and the countdown live. It is
 * labelled as a live feed everywhere it appears, because dressing a web page
 * up as an SMS would be the one dishonest thing in an app whose whole
 * argument is that it tells you the truth about what it can do.
 *
 * Storage is Postgres rather than the blob store the rest of this app was
 * built on, because that store was suspended at the account level hours
 * before the demonstration. One row per room, upserted in place, so the last
 * writer wins — which for a four-character code driven by one laptop is
 * exactly the semantics wanted.
 */

/** The project's public anon key. It is designed to ship in client bundles
 *  and is safe in source; what actually constrains it is row-level security
 *  on the two tables it can reach, and those hold public hazard warnings and
 *  throwaway demo rooms. Inlined rather than read from the environment so
 *  there is one fewer piece of deploy configuration to be wrong on the day. */
const SUPABASE_URL = 'https://lhfonctjtiediylfjscd.supabase.co'
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoZm9uY3RqdGllZGl5bGZqc2NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNzc0MDcsImV4cCI6MjEwMTg1MzQwN30.XzgVXT8DbjjocWLXvAtXc2p8F0t0nb6G9OjL_UDE74s'

const REST = `${SUPABASE_URL}/rest/v1`
const AUTH = {
  apikey: SUPABASE_ANON,
  authorization: `Bearer ${SUPABASE_ANON}`,
  'content-type': 'application/json',
}

/** A room older than this is somebody else's demo, or yesterday's. */
const TTL_MINUTES = 180
/** A trigger older than this stops being live, so a watcher joining late
 *  sees a quiet room rather than replaying an alarm from an hour ago. */
const TRIGGER_TTL_SECONDS = 180
const MAX_DEVICES = 12

type Phase = 'idle' | 'triggered' | 'alerting' | 'stood-down'

type Device = { id: string; name: string; at: string }

type Alert = {
  lat: number | null
  lon: number | null
  accuracy: number | null
  peak: number | null
  secondsLeft: number | null
  steps: string[]
  at: string
}

type Room = {
  room: string
  phase: Phase
  firedAt: string | null
  seq: number
  alert: Alert | null
  devices: Device[]
  at: string
}

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
      // A demo room is the last thing on this site that may be served stale.
      'cache-control': 'no-store',
      ...CORS,
    },
  })

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

/** Uppercase, alphanumeric, short. This gets read off a projector and typed
 *  into a phone by someone who is already nervous. */
function cleanRoom(raw: string | null): string | null {
  if (!raw) return null
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length < 3 || code.length > 8) return null
  return code
}

function emptyRoom(room: string): Room {
  return {
    room,
    phase: 'idle',
    firedAt: null,
    seq: 0,
    alert: null,
    devices: [],
    at: new Date().toISOString(),
  }
}

/** One database row as the clients read it. */
function fromRow(row: Record<string, unknown>): Room {
  return {
    room: String(row.room),
    phase: (row.phase as Phase) ?? 'idle',
    firedAt: (row.fired_at as string | null) ?? null,
    seq: Number(row.seq ?? 0),
    alert: (row.alert as Alert | null) ?? null,
    devices: Array.isArray(row.devices) ? (row.devices as Device[]) : [],
    at: String(row.at ?? new Date().toISOString()),
  }
}

/** A trigger nobody acted on goes quiet by itself. Without this a judge
 *  opening the page after the demo gets an alarm for a crash that is over. */
function fresh(room: Room): Room {
  if (room.firedAt && room.phase !== 'stood-down') {
    const age = (Date.now() - Date.parse(room.firedAt)) / 1000
    if (age > TRIGGER_TTL_SECONDS) return { ...room, phase: 'stood-down' }
  }
  return room
}

async function read(room: string): Promise<Room | null> {
  const res = await fetch(
    `${REST}/zetway_rooms?room=eq.${encodeURIComponent(room)}&limit=1`,
    { headers: AUTH, cache: 'no-store' },
  )
  if (!res.ok) throw new Error(`read ${res.status}: ${await res.text()}`)
  const rows = (await res.json()) as Record<string, unknown>[]
  if (!rows.length) return null
  const found = fromRow(rows[0])
  if (Date.now() - Date.parse(found.at) > TTL_MINUTES * 60_000) return null
  return found
}

async function write(room: Room): Promise<void> {
  const res = await fetch(`${REST}/zetway_rooms`, {
    method: 'POST',
    headers: { ...AUTH, prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      room: room.room,
      phase: room.phase,
      fired_at: room.firedAt,
      seq: room.seq,
      alert: room.alert,
      devices: room.devices,
      at: room.at,
    }),
  })
  if (!res.ok) throw new Error(`write ${res.status}: ${await res.text()}`)
}

export async function GET(request: Request): Promise<Response> {
  const room = cleanRoom(new URL(request.url).searchParams.get('room'))
  if (!room) return json({ error: 'room code missing or malformed' }, 400)
  try {
    const found = await read(room)
    return json(found ? fresh(found) : emptyRoom(room))
  } catch (err) {
    console.error('sim room read failed', err)
    return json({ error: 'could not read the room', detail: String(err) }, 502)
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'body must be JSON' }, 400)
  }

  const room = cleanRoom(typeof body.room === 'string' ? body.room : null)
  if (!room) return json({ error: 'room code missing or malformed' }, 400)

  const action = String(body.action ?? '')
  const now = new Date().toISOString()

  try {
    const existing = (await read(room)) ?? emptyRoom(room)

    if (action === 'join') {
      const id = String(body.deviceId ?? '').slice(0, 40) || 'unknown'
      const name = String(body.deviceName ?? 'A phone').slice(0, 40)
      const others = existing.devices.filter((d) => d.id !== id)
      const next: Room = {
        ...existing,
        devices: [...others, { id, name, at: now }].slice(-MAX_DEVICES),
        at: now,
      }
      await write(next)
      return json(fresh(next))
    }

    if (action === 'trigger') {
      const next: Room = {
        ...existing,
        phase: 'triggered',
        firedAt: now,
        seq: existing.seq + 1,
        alert: null,
        at: now,
      }
      await write(next)
      return json(next)
    }

    if (action === 'alert') {
      // The phone reporting what it actually did. Every figure here was
      // measured on the handset; nothing is invented by this function.
      const num = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null
      const steps = Array.isArray(body.steps)
        ? (body.steps as unknown[]).map((s) => String(s).slice(0, 200)).slice(0, 12)
        : []
      const next: Room = {
        ...existing,
        phase: 'alerting',
        alert: {
          lat: num(body.lat),
          lon: num(body.lon),
          accuracy: num(body.accuracy),
          peak: num(body.peak),
          secondsLeft: num(body.secondsLeft),
          steps,
          at: now,
        },
        at: now,
      }
      await write(next)
      return json(next)
    }

    if (action === 'stand-down') {
      const next: Room = { ...existing, phase: 'stood-down', at: now }
      await write(next)
      return json(next)
    }

    if (action === 'reset') {
      const next: Room = { ...emptyRoom(room), devices: existing.devices, at: now }
      await write(next)
      return json(next)
    }

    return json({ error: `unknown action ${action}` }, 400)
  } catch (err) {
    console.error('sim room write failed', err)
    return json({ error: 'could not write the room', detail: String(err) }, 502)
  }
}
