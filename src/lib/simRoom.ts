/**
 * The phone's end of the demo room.
 *
 * Nobody can crash a motorcycle on a stage, and shaking a handset hard enough
 * to clear 3g in front of an audience looks like a man shaking a handset. So
 * the impact is fired from a laptop and everything after it is untouched: the
 * same countdown, the same texts to the same real numbers, the same GPS fix
 * taken at the same moment. The simulation ends at the trigger, which is the
 * only part of the chain a stage cannot supply.
 *
 * Polling rather than a socket. A socket would be a connection to keep alive
 * through a conference wifi, a backgrounded web view and an Android doze
 * cycle, and the failure mode of a dropped socket is a demo that does nothing
 * with no explanation. A request every second and a half cannot drop; it can
 * only be late, and late by a second is invisible from the back of a room.
 */

const ENDPOINT = '/api/sim'
const POLL_MS = 1500

/** Where the API lives. The Android build is served from the APK, so its own
 *  origin is https://localhost and relative URLs would go nowhere. */
const BASE =
  typeof window !== 'undefined' && window.location.origin.startsWith('https://localhost')
    ? 'https://backprop-pirates.vercel.app'
    : ''

export type RoomPhase = 'idle' | 'triggered' | 'alerting' | 'stood-down'

export type RoomState = {
  room: string
  phase: RoomPhase
  firedAt: string | null
  seq: number
  devices: { id: string; name: string; at: string }[]
}

async function post(body: Record<string, unknown>): Promise<RoomState | null> {
  try {
    const res = await fetch(`${BASE}${ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as RoomState
  } catch {
    return null
  }
}

export async function joinRoom(
  room: string,
  deviceId: string,
  deviceName: string,
): Promise<RoomState | null> {
  return post({ action: 'join', room, deviceId, deviceName })
}

/** Tell the room what the phone actually did, so the watchers see the real
 *  position and the real list of what was sent rather than a mock-up. */
export async function reportAlert(
  room: string,
  alert: {
    lat: number | null
    lon: number | null
    accuracy: number | null
    peak: number | null
    secondsLeft: number | null
    steps: string[]
  },
): Promise<void> {
  await post({ action: 'alert', room, ...alert })
}

export async function standDownRoom(room: string): Promise<void> {
  await post({ action: 'stand-down', room })
}

export async function readRoom(room: string): Promise<RoomState | null> {
  try {
    const res = await fetch(`${BASE}${ENDPOINT}?room=${encodeURIComponent(room)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as RoomState
  } catch {
    return null
  }
}

/**
 * Watch a room and call back exactly once per new trigger.
 *
 * Keyed on the sequence number rather than on the phase, so a room that is
 * fired, stood down and fired again fires the phone twice, while a phone that
 * polls three times during one alert fires it once. Getting this wrong in
 * either direction is a demo that either does nothing or will not stop.
 */
export function watchRoom(
  room: string,
  onTrigger: (seq: number) => void,
): () => void {
  let stopped = false
  let lastSeq: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    if (stopped) return
    const state = await readRoom(room)
    if (!stopped && state) {
      // The first poll establishes a baseline instead of firing. Joining a
      // room that is already mid-alert must not set the phone off in
      // somebody's pocket on the way to the stage.
      if (lastSeq === null) {
        lastSeq = state.seq
      } else if (state.seq > lastSeq) {
        lastSeq = state.seq
        if (state.phase === 'triggered') onTrigger(state.seq)
      }
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS)
  }

  void tick()

  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}

/** A stable per-install id, so the control page can show how many phones are
 *  in the room without anything identifying whose they are. */
export function deviceId(): string {
  const KEY = 'zetway.deviceId'
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const made = Math.random().toString(36).slice(2, 10)
    localStorage.setItem(KEY, made)
    return made
  } catch {
    return 'anon'
  }
}

const ROOM_KEY = 'zetway.simRoom'

export function readSavedRoom(): string {
  try {
    return localStorage.getItem(ROOM_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeSavedRoom(room: string): void {
  try {
    if (room) localStorage.setItem(ROOM_KEY, room)
    else localStorage.removeItem(ROOM_KEY)
  } catch {
    // A demo room that does not survive a reload is a small loss.
  }
}
