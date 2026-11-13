/** The road scanner's half of the job that happens in the web layer.
 *
 * The service feels the jolt. This file decides what becomes of it: written
 * to the phone first, sent to the shared reports feed when there is a
 * network, and never lost in between. That order matters on a ride through
 * Mauritius, where the signal goes in the sugar cane and comes back in the
 * next village — a scanner that only worked online would miss exactly the
 * roads nobody has mapped.
 *
 * The log on the phone is also the reason the screen has anything to show
 * before anyone else has ridden the same road. A rider's own jolts are
 * theirs immediately; they just are not a road defect until two other
 * reports land beside them.
 */

import { consumePendingJolts, onNativeJolt, setRoadScan, type NativeJolt } from './nativeCrash'
import { submitReport } from './reports'

const PREF_KEY = 'zetway.road.scan'
const LOG_KEY = 'zetway.road.log'

/** How long a jolt stays on the phone.
 *
 *  The shared feed drops every report after four hours, which is right for a
 *  hazard someone is riding towards and useless for a pothole: holes are
 *  there next week. So the phone keeps its own for a week, which is long
 *  enough to build a picture of a commute and short enough that a log of
 *  where somebody has been does not become a history of their year. The
 *  screen says this, and offers to erase it. */
export const LOG_KEEP_DAYS = 7

/** A cap as well as an age, because a bad road could produce hundreds in one
 *  ride and localStorage is small. Oldest go first. */
const MAX_LOG = 400

export type LoggedJolt = {
  /** Local id. Not the one the reports API hands back; see serverId. */
  id: string
  lat: number
  lon: number
  /** ISO 8601, so the clustering reads it exactly like a server report. */
  at: string
  /** Peak departure of the vertical axis from rest, in g. */
  peakG: number
  /** Speed at the jolt, m/s. */
  speedMs: number
  /** Set once the reports API has accepted it. Also how the same jolt is
   *  recognised when it comes back from the feed, so it is not counted
   *  twice. */
  serverId?: string
  /** The API refused it — outside Mauritius, most likely. Kept visible on
   *  the phone, never retried: a request that was wrong once is wrong
   *  every time, and retrying it forever is just noise. */
  refused?: boolean
}

export function readScanPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on'
  } catch {
    return false
  }
}

export function writeScanPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // A preference that will not save is a scanner the rider has to switch
    // on again next time. Worth nothing to throw over.
  }
}

/** Push the saved preference into the service and report what it says back.
 *  Called on every mount, because the service's own copy is lost whenever
 *  Android restarts the process. */
export async function applyScanPref(): Promise<{ enabled: boolean; watching: boolean }> {
  const on = readScanPref()
  const r = await setRoadScan(on)
  return { enabled: r.enabled, watching: r.watching }
}

export function readLog(): LoggedJolt[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - LOG_KEEP_DAYS * 86_400_000
    return (parsed as LoggedJolt[]).filter(
      (j) =>
        typeof j?.lat === 'number' &&
        typeof j?.lon === 'number' &&
        typeof j?.at === 'string' &&
        Date.parse(j.at) >= cutoff,
    )
  } catch {
    return []
  }
}

function writeLog(log: LoggedJolt[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG)))
  } catch {
    // Full storage. The jolts already sent are safe in the feed; the rest
    // are lost, which is better than an exception on a riding screen.
  }
}

export function clearLog(): void {
  try {
    localStorage.removeItem(LOG_KEY)
  } catch {
    // Nothing to do, and nothing worth saying about it.
  }
}

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5

/**
 * Add jolts to the log, ignoring any that are already in it.
 *
 * Two routes deliver the same jolt in one edge case — the service queues it
 * because no page was listening, and a page appears before the queue is
 * drained — so the timestamp is used as the identity. The service debounces
 * to one jolt per four seconds, so two distinct jolts cannot share a
 * millisecond.
 */
export function recordJolts(jolts: NativeJolt[]): LoggedJolt[] {
  if (jolts.length === 0) return readLog()
  const log = readLog()
  const known = new Set(log.map((j) => Date.parse(j.at)))

  for (const j of jolts) {
    if (known.has(j.at)) continue
    known.add(j.at)
    log.push({
      id: `${j.at}-${Math.random().toString(36).slice(2, 8)}`,
      lat: round5(j.lat),
      lon: round5(j.lon),
      at: new Date(j.at).toISOString(),
      peakG: Math.round(j.peakG * 100) / 100,
      speedMs: Math.round(j.speed * 10) / 10,
    })
  }

  log.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  writeLog(log)
  return log
}

/** What a report says about itself in the shared feed. Short, because the
 *  field is capped at 140 characters and because there is nothing else
 *  honest to add: the phone felt a bang at a speed, and that is all. */
export function joltNote(j: LoggedJolt): string {
  return `Vertical jolt ${j.peakG.toFixed(1)}g at ${Math.round(j.speedMs * 3.6)} km/h, logged by the phone`
}

export type FlushResult = { sent: number; waiting: number; refused: number }

/**
 * Send everything the phone is still holding.
 *
 * Failures are sorted into two kinds, because they deserve different
 * treatment. A network that is not there will be there later, so the jolt
 * stays queued. A refusal from the function — a coordinate outside
 * Mauritius, say — will be refused identically forever, so it is marked and
 * left alone rather than retried on every screen that opens.
 */
export async function flushLog(): Promise<FlushResult> {
  const log = readLog()
  const unsent = log.filter((j) => !j.serverId && !j.refused)
  let sent = 0

  for (const jolt of unsent) {
    try {
      const report = await submitReport({
        kind: 'pothole',
        lat: jolt.lat,
        lon: jolt.lon,
        note: joltNote(jolt),
      })
      jolt.serverId = report.id
      sent++
    } catch (err) {
      // submitReport throws the function's own message for a 4xx and a
      // fetch error for no network. Only the first is permanent.
      if (err instanceof Error && /coordinates|kind must be/.test(err.message)) {
        jolt.refused = true
      } else {
        break // no network: stop trying, keep the rest queued, try later
      }
    }
  }

  writeLog(log)
  return {
    sent,
    waiting: log.filter((j) => !j.serverId && !j.refused).length,
    refused: log.filter((j) => j.refused).length,
  }
}

/**
 * Collect everything the service has for us, now and as it arrives.
 *
 * Both routes are needed and neither is the exceptional one. The queue holds
 * what was logged while the app was closed, which on a real ride is most of
 * it; the listener catches what happens while somebody has the screen open,
 * which is how the feature is demonstrated.
 *
 * Returns an unsubscribe.
 */
export async function collectJolts(onLog: (log: LoggedJolt[]) => void): Promise<() => void> {
  const waiting = await consumePendingJolts()
  if (waiting.length) onLog(recordJolts(waiting))

  return onNativeJolt((jolt) => {
    onLog(recordJolts([jolt]))
  })
}
