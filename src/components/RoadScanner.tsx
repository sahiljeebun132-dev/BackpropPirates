import { useCallback, useEffect, useMemo, useState } from 'react'

import { isNative } from '../lib/platform'
import {
  clusterPotholes, CLUSTER_RADIUS_M, JOLT_THRESHOLD_G, maintenanceSummary,
  metresBetween, VERIFIED_MIN_REPORTS, type PotholeCluster, type PotholeReport,
} from '../lib/potholes'
import { timeAgo, type HazardReport } from '../lib/reports'
import {
  applyScanPref, clearLog, collectJolts, flushLog, LOG_KEEP_DAYS, readLog, readScanPref,
  writeScanPref, type FlushResult, type LoggedJolt,
} from '../lib/roadScan'
import { Card, CardTitle, Icon, IconChip, PageHeader } from './ui'

/**
 * The road scanner: what the phone felt, and which of it is a road defect.
 *
 * The argument this screen has to make is that a jolt and a defect are not
 * the same thing. One phone banging once is a drain cover, a kerb, a bag
 * falling over — and saying otherwise would send a maintenance crew to a
 * drain cover. So a cluster is shown with the count that produced it and
 * the rule stated above the list, and the promotion from "unverified jolt"
 * to "verified road defect" is three reports inside fifty metres and
 * nothing else. Anyone can check the arithmetic; scripts/check_potholes.mjs
 * does, against fixtures at measured distances.
 *
 * The switch is at the top rather than buried in a settings page because of
 * what it turns on. This records where the rider was, which is personal
 * data under the Data Protection Act 2017, and the only thing that makes it
 * lawful here is that they chose it — so the choice has to be as easy to
 * withdraw as it was to make, and what it collects has to be said in the
 * same breath, not linked to.
 */
export function RoadScanner({
  reports,
  reportsStatus,
  onBack,
  position,
  onUseGps,
}: {
  /** The shared feed, already fetched for the screen the rider came from.
   *  Everything that is not a pothole is ignored here. */
  reports: HazardReport[]
  reportsStatus: 'loading' | 'ready' | 'error'
  onBack: () => void
  position: { lat: number; lon: number } | null
  onUseGps: () => void
}) {
  const [scanning, setScanning] = useState(() => readScanPref())
  const [watching, setWatching] = useState(false)
  const [log, setLog] = useState<LoggedJolt[]>(() => readLog())
  const [flush, setFlush] = useState<FlushResult | null>(null)
  const [exported, setExported] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)

  // The service loses its copy of the preference whenever Android restarts
  // the process, so the page pushes it back on every mount rather than
  // trusting it to have survived.
  useEffect(() => {
    void applyScanPref().then((s) => {
      setScanning(s.enabled)
      setWatching(s.watching)
    })
  }, [])

  const send = useCallback(() => {
    void flushLog().then((r) => {
      setFlush(r)
      setLog(readLog())
    })
  }, [])

  // Everything the service has been holding while the app was closed, plus
  // whatever arrives while this screen is up. Each one is sent as it lands
  // rather than waiting for the next visit: the phone is most likely to
  // have a network at the end of the ride, which is also when the app is
  // most likely to be open.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    void collectJolts((log) => {
      setLog(log)
      send()
    }).then((off) => {
      unsubscribe = off
    })
    return () => unsubscribe?.()
  }, [send])

  // Try once on arrival, and again whenever the network comes back. A ride
  // through the middle of the island is mostly spent with no signal, so the
  // moment there is one is the moment worth using.
  useEffect(() => {
    send()
    window.addEventListener('online', send)
    return () => window.removeEventListener('online', send)
  }, [send])

  const toggle = async () => {
    const next = !scanning
    writeScanPref(next)
    setScanning(next)
    const s = await applyScanPref()
    setScanning(s.enabled)
    setWatching(s.watching)
  }

  /**
   * Every pothole report this screen knows about, from both halves.
   *
   * The phone's own log is the half that works with no signal and the half
   * that has anything in it on a road nobody else has ridden. The feed is
   * the half that can tell you three different people hit the same hole.
   * A jolt that has been accepted by the feed exists in both, so it is
   * matched on the id the API gave it and counted once.
   */
  const points = useMemo<PotholeReport[]>(() => {
    const mine = log.map((j) => ({ id: j.serverId ?? j.id, lat: j.lat, lon: j.lon, at: j.at }))
    const ids = new Set(mine.map((p) => p.id))
    const theirs = reports
      .filter((r) => r.kind === 'pothole' && !ids.has(r.id))
      .map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, at: r.at }))
    return [...mine, ...theirs]
  }, [log, reports])

  const clusters = useMemo(() => clusterPotholes(points), [points])
  const verified = clusters.filter((c) => c.verified)
  const unsent = log.filter((j) => !j.serverId && !j.refused).length

  const exportSummary = async () => {
    const text = maintenanceSummary(clusters)
    setExported(text)
    // Share first, because the rider wants this in an email or a WhatsApp
    // message to the RDA and not in a box on a phone screen. Most Android
    // web views do not implement it, so the clipboard is the real path and
    // the text below is the one that always works.
    try {
      const share = (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share
      if (share) {
        await share.call(navigator, { title: 'Road surface log', text })
        setExportNote('Handed to whichever app you picked.')
        return
      }
    } catch {
      // A cancelled share is a decision, not a failure. Fall through to the
      // clipboard so the text is still somewhere useful.
    }
    try {
      await navigator.clipboard.writeText(text)
      setExportNote('Copied. Paste it into an email or a message.')
    } catch {
      setExportNote('Copy it from the box below.')
    }
  }

  return (
    <>
      <PageHeader
        title="Road scanner"
        onBack={onBack}
        badge={
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              scanning ? 'bg-flag-green/15 text-flag-green' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {scanning ? 'On' : 'Off'}
          </span>
        }
      />

      <Card accent={scanning ? 'green' : 'slate'}>
        <div className="flex items-start gap-3">
          <IconChip accent={scanning ? 'green' : 'slate'} size="lg">
            {Icon.road()}
          </IconChip>
          <div className="min-w-0">
            <CardTitle>Log potholes while I ride</CardTitle>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              You cannot tap a screen while steering, so the phone does it. When it takes a
              vertical kick over {JOLT_THRESHOLD_G.toFixed(1)}g while you are actually moving, it
              drops a point where you were. Nothing beeps and nothing opens — you find out
              afterwards, here.
            </p>
          </div>
        </div>

        {!isNative() ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
            This one only exists in the Android app. A browser tab is throttled the moment it goes
            to the background and suspended when the screen goes off, so a web page cannot watch a
            motion sensor from inside a pocket. Offering it here would be a promise that quietly
            does nothing.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void toggle()}
              className={`mt-3 w-full rounded-xl px-4 py-3.5 text-sm font-semibold ${
                scanning
                  ? 'bg-slate-100 text-slate-800 ring-1 ring-slate-200 active:bg-slate-200'
                  : 'bg-ink text-white active:opacity-90'
              }`}
            >
              {scanning ? 'Turn the scanner off' : 'Turn the scanner on'}
            </button>

            {scanning && !watching && (
              <p className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                Nothing is being logged at this moment. The scanner shares crash watch&rsquo;s hold
                on the motion sensor rather than taking a second one — one service, one wake lock,
                one bite out of the battery — so it runs while crash watch is armed and stops when
                it is not. Arm crash watch before you set off and this runs with it.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Immediately under the switch, because consent that is not informed
          at the moment it is given is not consent. Open, not behind a
          disclosure. */}
      <Card accent="slate">
        <CardTitle>What switching this on records</CardTitle>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700">
          <li>
            <span className="font-semibold">Where you were, each time it fires.</span> That is
            location data about you, and the Data Protection Act 2017 treats it as personal data.
            Nothing makes it lawful here except that you chose it, so turning the switch above off
            stops it at once and no part of the app asks you again.
          </li>
          <li>
            <span className="font-semibold">Four things per jolt.</span> The position, the time,
            how hard the kick was and how fast you were going. No name, no account, no device
            identifier — there is nothing in a report that ties it to you, and nothing in Zetway
            that knows who you are.
          </li>
          <li>
            <span className="font-semibold">Kept {LOG_KEEP_DAYS} days on this phone.</span> Long
            enough to see a commute, short enough that it does not become a history of your year.
            Erase it below whenever you like.
          </li>
          <li>
            <span className="font-semibold">Sent to the shared feed.</span> Other riders see the
            same points, and like every report in that feed they are deleted after four hours. The
            week-long copy is the one on this phone.
          </li>
          <li>
            <span className="font-semibold">Nothing while stopped.</span> A jolt below 10 km/h is a
            phone being handled, not a wheel in a hole, and it is thrown away. So is a jolt the
            phone cannot place with a fix from the last few seconds.
          </li>
        </ul>
        {log.length > 0 && (
          <button
            type="button"
            onClick={() => {
              clearLog()
              setLog([])
              setFlush(null)
            }}
            className="mt-3 w-full rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-flag-red ring-1 ring-flag-red/30 active:bg-flag-red/5"
          >
            Erase the {log.length} jolt{log.length === 1 ? '' : 's'} on this phone
          </button>
        )}
      </Card>

      <Card accent={verified.length ? 'red' : 'slate'}>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle>What has been found</CardTitle>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
            {points.length} report{points.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {VERIFIED_MIN_REPORTS} or more reports within {CLUSTER_RADIUS_M} m of each other is a
          verified road defect. Fewer is one phone&rsquo;s bump, and it is listed as that. Nothing
          here is a model or an estimate — the count under each point is the arithmetic.
        </p>

        {points.length === 0 && (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">
            {reportsStatus === 'error'
              ? 'The shared feed is unreachable, so this is only what is on this phone — and this phone has logged nothing yet.'
              : scanning
                ? 'Nothing logged yet. Ride with the scanner on and points appear here by themselves.'
                : 'Nothing logged, and the scanner is off.'}
          </p>
        )}

        {clusters.length > 0 && (
          <ul className="mt-3 space-y-2">
            {clusters.map((c) => (
              <ClusterRow key={c.id} cluster={c} position={position} />
            ))}
          </ul>
        )}

        {!position && points.length > 0 && (
          <button
            type="button"
            onClick={onUseGps}
            className="mt-2 text-[11px] font-semibold text-brand-deep underline"
          >
            Use my location to sort these by distance
          </button>
        )}

        {unsent > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            {unsent} not sent to the shared feed yet. They are on the phone and go up the next time
            there is a network.
          </p>
        )}
        {flush && flush.refused > 0 && (
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            {flush.refused} were refused by the reports service — a position outside Mauritius, most
            likely. They stay on the phone and are not retried.
          </p>
        )}
      </Card>

      <Card accent="blue">
        <CardTitle>Send this to the Road Development Authority</CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          One tap writes a plain-text list — coordinates, how many reports, first and last seen —
          and hands it to whatever you want to send it with. Zetway files nothing with anyone and
          has no line to the RDA: the text is yours, and sending it is your decision.
        </p>
        <button
          type="button"
          onClick={() => void exportSummary()}
          disabled={clusters.length === 0}
          className="mt-3 w-full rounded-xl bg-brand-deep px-4 py-3.5 text-sm font-semibold text-white active:bg-brand-deep/90 disabled:bg-slate-200 disabled:text-slate-500"
        >
          {clusters.length === 0
            ? 'Nothing to export yet'
            : `Export ${clusters.length} point${clusters.length === 1 ? '' : 's'} as text`}
        </button>
        {exportNote && <p className="mt-2 text-[11px] text-slate-600">{exportNote}</p>}
        {exported && (
          <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
            {exported}
          </pre>
        )}
      </Card>
    </>
  )
}

/** One group: what it is called, what it is made of, and where. */
function ClusterRow({
  cluster,
  position,
}: {
  cluster: PotholeCluster
  position: { lat: number; lon: number } | null
}) {
  const away = position ? Math.round(metresBetween(position, cluster)) : null
  return (
    <li
      className={`rounded-xl p-3 ring-1 ${
        cluster.verified ? 'bg-flag-red/5 ring-flag-red/25' : 'bg-slate-50 ring-slate-200'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            cluster.verified ? 'bg-flag-red' : 'bg-slate-400'
          }`}
        />
        <span className="text-sm font-semibold text-slate-900">
          {cluster.verified ? 'Verified road defect' : 'Unverified jolt'}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-700 ring-1 ring-slate-200">
          {cluster.count} report{cluster.count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-600">
        {cluster.lat.toFixed(5)}, {cluster.lon.toFixed(5)}
        {away !== null && (
          <span className="ml-2 font-sans text-slate-500">
            {away < 1000 ? `${away} m away` : `${(away / 1000).toFixed(1)} km away`}
          </span>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {cluster.count === 1
          ? `Seen ${timeAgo(cluster.firstSeen)}`
          : `First ${timeAgo(cluster.firstSeen)}, last ${timeAgo(cluster.lastSeen)}`}
      </p>
    </li>
  )
}
