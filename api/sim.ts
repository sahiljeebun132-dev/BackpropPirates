/** The demo room: one laptop, one phone, and a row of judges watching.
 *
 * On stage nobody can crash a motorcycle, and shaking a phone at 3g in front
 * of an audience is both unconvincing and easy to fumble. So this is a room
 * the phone joins and a laptop can fire into, and everything downstream of
 * the trigger is the real thing: the real sensor path, the real countdown, the
 * real texts to real numbers with a real GPS fix.
 *
 *   GET  /api/sim?room=ABCD        the room as it stands
 *   POST /api/sim  {action, room}  join | trigger | alert | stand-down
 *
 * Why a watch feed exists. The obvious demo is "every judge's phone rings",
 * and a phone cannot do that: one handset places one call at a time, which is
 * the carrier's rule and not something an app may argue with. The texts do go
 * to everyone at once, and they are the real artefact. This feed is the thing
 * that makes it visible in a room — the judges open a page, and the moment the
 * crash fires they get the alarm, the position and the countdown live. It is
 * labelled as a live feed everywhere it appears, because dressing a web page
 * up as an SMS would be the one dishonest thing in an app whose whole argument
 * is that it tells you the truth about what it can do.
 *
 * Storage is one blob per room, overwritten in place. That makes the last
 * writer win, which for a four-character room code driven by one laptop is
 * exactly the semantics wanted. Rooms expire so a demo cannot haunt the next.
 */

import { get, put } from '@vercel/blob'

const PREFIX = 'sim/'
/** A room older than this is somebody else's demo, or yesterday's. */
const TTL_MINUTES = 180
/** A trigger older than this stops being live, so a watcher that joins late
 *  sees a quiet room rather than replaying an alarm from an hour ago. */
const TRIGGER_TTL_SECONDS = 180
const MAX_DEVICES = 12

type Phase = 'idle' | 'triggered' | 'alerting' | 'stood-down'

type Device = { id: string; name: string; at: string }

type Room = {
  room: string
  phase: Phase
  /** Set when a laptop fires. The phone watches this and nothing else. */
  firedAt: string | null
  /** Bumped on every trigger so a phone can tell a new one from a repeat
   *  even if it polls across a stand-down and a re-arm. */
  seq: number
  /** What the phone reported back once it acted: where it was, how hard the
   *  simulated impact was, and what it managed to send. */
  alert: {
    lat: number | null
    lon: number | null
    accuracy: number | null
    peak: number | null
    secondsLeft: number | null
    steps: string[]
    at: string
  } | null
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

/** Four characters, no vowels and no look-alikes, because this gets read off
 *  a projector and typed into a phone by someone who is already nervous. */
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

function fresh(room: Room): Room {
  // A trigger that nobody acted on goes quiet by itself. Without this a judge
  // opening the page after the demo gets an alarm for a crash that is over.
  if (room.firedAt) {
    const age = (Date.now() - Date.parse(room.firedAt)) / 1000
    if (age > TRIGGER_TTL_SECONDS && room.phase !== 'stood-down') {
      return { ...room, phase: 'stood-down' }
    }
  }
  return room
}

async function read(room: string): Promise<Room | null> {
  try {
    // The store is private, so the body comes back through the SDK with the
    // server's token. Fetching blob.url instead returns nothing useful and
    // fails quietly, which is how this spent a deploy appearing to work while
    // every read returned an empty room.
    const got = await get(`${PREFIX}${room}.json`, { access: 'private' })
    if (!got || got.statusCode !== 200) return null
    const parsed = JSON.parse(await new Response(got.stream).text()) as Room
    if (Date.now() - Date.parse(parsed.at) > TTL_MINUTES * 60_000) return null
    return parsed
  } catch {
    return null
  }
}

async function write(room: Room): Promise<void> {
  // A room is one blob rewritten in place, so overwriting is the whole point
  // and has to be asked for explicitly. No cache hint: every reader comes
  // through this function, which already answers no-store.
  await put(`${PREFIX}${room.room}.json`, JSON.stringify(room), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

export async function GET(request: Request): Promise<Response> {
  const room = cleanRoom(new URL(request.url).searchParams.get('room'))
  if (!room) return json({ error: 'room code missing or malformed' }, 400)

  const found = await read(room)
  if (!found) return json(emptyRoom(room))
  return json(fresh(found))
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
  const existing = (await read(room)) ?? emptyRoom(room)
  const now = new Date().toISOString()

  try {
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
    const next = { ...emptyRoom(room), devices: existing.devices }
    await write(next)
    return json(next)
  }

  return json({ error: `unknown action ${action}` }, 400)
  } catch (err) {
    console.error('sim room write failed', err)
    return json(
      { error: 'could not write the room', detail: String((err as Error)?.message ?? err) },
      502,
    )
  }
}
