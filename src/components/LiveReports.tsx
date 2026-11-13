import { useState } from 'react'

import {
  REPORT_DESCRIPTION, REPORT_KINDS, REPORT_LABEL, REPORT_SEVERITY,
  submitReport, timeAgo, type HazardReport, type ReportKind,
} from '../lib/reports'

const STYLE = {
  critical: { box: 'bg-red-50 ring-red-200', dot: 'bg-flag-red' },
  warning: { box: 'bg-amber-50 ring-amber-200', dot: 'bg-flag-yellow' },
  info: { box: 'bg-slate-50 ring-slate-200', dot: 'bg-slate-400' },
} as const

type Props = {
  reports: HazardReport[]
  status: 'loading' | 'ready' | 'error'
  /** Where a new report is pinned: the rider's GPS if allowed, else the
   *  midpoint of the corridor they are looking at. */
  reportAt: { lat: number; lon: number }
  usingGps: boolean
  radiusKm: number
  onReported: () => void
  onUseGps: () => void
}

export function LiveReports(props: Props) {
  const { reports, status, reportAt, usingGps, radiusKm, onReported, onUseGps } = props
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ReportKind>('crash')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      await submitReport({ kind, lat: reportAt.lat, lon: reportAt.lon, note })
      setNote('')
      setOpen(false)
      onReported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">What riders are reporting</h2>
        {status === 'ready' && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flag-green opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-flag-green" />
            </span>
            Live
          </span>
        )}
      </div>

      {status === 'loading' && (
        <p className="mt-2 text-sm text-slate-500">Checking for reports…</p>
      )}

      {status === 'error' && (
        <p className="mt-2 text-sm text-slate-600">
          Reports are unavailable right now. Everything else on this page still works.
        </p>
      )}

      {status === 'ready' && reports.length === 0 && (
        <p className="mt-2 text-sm text-slate-600">
          Nothing reported within {radiusKm} km in the last few hours. If you pass something, tell
          the rider behind you.
        </p>
      )}

      {reports.length > 0 && (
        <ul className="mt-3 space-y-2">
          {reports.map((r) => {
            const s = STYLE[REPORT_SEVERITY[r.kind]]
            return (
              <li key={r.id} className={`rounded-xl p-3 ring-1 ${s.box}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                  <span className="text-sm font-semibold text-slate-900">
                    {REPORT_LABEL[r.kind]}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
                    {r.distanceKm !== undefined ? `${r.distanceKm} km · ` : ''}
                    {timeAgo(r.at)}
                  </span>
                </div>
                {r.note && <p className="mt-1 text-sm leading-snug text-slate-700">{r.note}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-xl bg-flag-red px-4 py-3 text-sm font-semibold text-white active:bg-flag-red/90"
        >
          Report a hazard
        </button>
      ) : (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-xs font-semibold text-slate-900">What did you see?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {REPORT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={k === kind}
                onClick={() => setKind(k)}
                className={`rounded-lg px-2.5 py-2 text-left text-xs font-medium ring-1 transition ${
                  k === kind
                    ? 'bg-brand-deep text-white ring-brand-deep'
                    : 'bg-white text-slate-700 ring-slate-200'
                }`}
              >
                <span className="block">{REPORT_LABEL[k]}</span>
                <span className={`block text-[10px] leading-tight ${k === kind ? 'text-white/75' : 'text-slate-500'}`}>
                  {REPORT_DESCRIPTION[k]}
                </span>
              </button>
            ))}
          </div>

          <label className="mt-2 block">
            <span className="sr-only">Add a detail</span>
            <input
              type="text"
              value={note}
              maxLength={140}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Where exactly? Optional"
              className="w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm text-slate-900 ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
            />
          </label>

          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            {usingGps ? (
              'Pinned to where you are now.'
            ) : (
              <>
                Pinned to the middle of this route, because location is off.{' '}
                <button type="button" onClick={onUseGps} className="font-semibold text-brand-deep underline">
                  Use my location
                </button>
              </>
            )}{' '}
            Other riders see this for a few hours. Don&rsquo;t name anyone, and don&rsquo;t report
            while riding.
          </p>

          {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={send}
              disabled={sending}
              className="flex-1 rounded-lg bg-flag-red px-3 py-2.5 text-sm font-semibold text-white active:bg-flag-red/90 disabled:bg-slate-300"
            >
              {sending ? 'Sending…' : `Report ${REPORT_LABEL[kind].toLowerCase()}`}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** "About 0 km away" is not a sentence anyone writes. */
function describeDistance(km: number | undefined): string {
  if (km === undefined) return ''
  if (km < 1) return 'Less than a kilometre away, '
  return `About ${Math.round(km)} km away, `
}

/** A crash or flood sitting on the route deserves to be seen before the score. */
export function LiveAlertBanner({ reports }: { reports: HazardReport[] }) {
  const urgent = reports.filter((r) => REPORT_SEVERITY[r.kind] === 'critical')
  if (!urgent.length) return null
  const first = urgent[0]
  return (
    <section className="rounded-2xl bg-flag-red p-4 text-white shadow-sm">
      <p className="text-sm font-bold">
        {REPORT_LABEL[first.kind]} reported on this route
      </p>
      <p className="mt-1 text-sm leading-snug text-white/90">
        {first.note || 'No detail given.'} {describeDistance(first.distanceKm)}
        {timeAgo(first.at)}.
        {urgent.length > 1 ? ` ${urgent.length - 1} more below.` : ''}
      </p>
    </section>
  )
}
