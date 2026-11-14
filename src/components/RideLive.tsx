import { useCallback, useEffect, useRef, useState } from 'react'

import { BEAT_MS, beat, forgetSession, lookOnly, type Rider } from '../lib/presence'
import type { HazardReport } from '../lib/reports'
import type { AppData } from '../lib/types'
import { LiveMap, type Hazard } from './LiveMap'
import { Card, CardTitle, Details, PageHeader } from './ui'

/**
 * The road around you while you are on it.
 *
 * Two things a rider wants in motion and cannot get from a list: where the
 * black spots are relative to them right now, and whether anybody else is
 * out there. The first comes from geometry that ships with the app. The
 * second needs other people, which is where the care goes.
 *
 * SHARING IS OFF AND STAYS OFF. Looking costs nothing and tells nobody
 * anything, so looking is the default and needs no decision. Appearing to
 * others is a separate switch, it is never remembered between sessions, and
 * the screen says exactly what leaves the phone before it is touched. An app
 * that quietly resumed broadcasting a position because of a tap last week
 * would be the worst thing in a product whose pitch is that it asks for
 * nothing.
 */

/** How far the frame reaches. Three steps, because a rider in motion is not
 *  going to pinch-zoom. */
const RADII = [1, 2.5, 5] as const

export function RideLive({
  data,
  reports,
  position,
  onUseGps,
  onBack,
}: {
  data: AppData
  reports: HazardReport[]
  position: { lat: number; lon: number } | null
  onUseGps: () => void
  onBack: () => void
}) {
  const [radiusKm, setRadiusKm] = useState<number>(2.5)
  const [sharing, setSharing] = useState(false)
  const [riders, setRiders] = useState<Rider[]>([])
  const [heading, setHeading] = useState<number | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const previous = useRef<{ lat: number; lon: number } | null>(null)

  // Heading from successive fixes rather than the compass: a phone in a tank
  // bag points wherever the bag points, but two positions a few seconds
  // apart point down the road.
  useEffect(() => {
    if (!position) return
    const was = previous.current
    previous.current = position
    if (!was) return
    const dLat = position.lat - was.lat
    const dLon = position.lon - was.lon
    // Under about fifteen metres it is GPS noise, not movement, and letting
    // noise steer the arrow makes it spin on a stationary bike.
    if (Math.hypot(dLat * 110.574, dLon * 104.4) < 0.015) return
    setHeading((Math.atan2(dLon * 104.4, dLat * 110.574) * 180) / Math.PI)
  }, [position])

  const poll = useCallback(async () => {
    if (!position) return
    const got = sharing
      ? await beat(position.lat, position.lon, radiusKm)
      : await lookOnly(position.lat, position.lon, radiusKm)
    setReachable(got !== null)
    if (got) setRiders(got)
  }, [position, radiusKm, sharing])

  useEffect(() => {
    void poll()
    const t = setInterval(() => void poll(), BEAT_MS)
    return () => clearInterval(t)
  }, [poll])

  // Leaving the screen stops the broadcast and discards the session, so
  // coming back is a new anonymous dot rather than the same one resuming.
  useEffect(() => {
    return () => forgetSession()
  }, [])

  const hazards: Hazard[] = reports.map((r) => ({ kind: r.kind, lat: r.lat, lon: r.lon }))

  return (
    <div className="zw-page">
      <PageHeader title="On the road" onBack={onBack} />

      {!position ? (
        <Card>
          <CardTitle>Where are you?</CardTitle>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            The map centres on you and the road moves under it. Nothing is
            drawn until the phone has a fix.
          </p>
          <button
            type="button"
            onClick={onUseGps}
            className="mt-3 w-full rounded-2xl bg-brand-deep px-4 py-4 text-base font-bold text-white"
          >
            Use my location
          </button>
        </Card>
      ) : (
        <>
          <LiveMap
            data={data}
            position={position}
            heading={heading}
            riders={riders}
            hazards={hazards}
            radiusKm={radiusKm}
          />

          <div className="flex gap-2">
            {RADII.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={r === radiusKm}
                onClick={() => setRadiusKm(r)}
                className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-bold transition ${
                  r === radiusKm
                    ? 'bg-brand-deep text-white'
                    : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                }`}
              >
                {r} km
              </button>
            ))}
          </div>

          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>
                  {riders.length === 0
                    ? 'No other riders nearby'
                    : `${riders.length} other ${riders.length === 1 ? 'rider' : 'riders'} within ${radiusKm} km`}
                </CardTitle>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  {reachable === false
                    ? 'Cannot reach the shared feed. The map and the black spots still work — they are on the phone.'
                    : sharing
                      ? 'You are a blue dot on their map too.'
                      : 'You can see them. They cannot see you.'}
                </p>
              </div>
              <span
                className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                  reachable === false ? 'bg-slate-300' : 'bg-emerald-500'
                }`}
                aria-hidden="true"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                if (sharing) forgetSession()
                setSharing((s) => !s)
              }}
              aria-pressed={sharing}
              className={`mt-3 w-full rounded-2xl px-4 py-3.5 text-sm font-bold transition ${
                sharing
                  ? 'bg-flag-red text-white'
                  : 'bg-slate-100 text-slate-800 ring-1 ring-slate-200'
              }`}
            >
              {sharing ? 'Stop appearing to others' : 'Let others see me'}
            </button>

            <Details summary="What that sends, exactly">
              <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-600">
                <li>
                  <span className="font-semibold">A point, rounded to about 100 m.</span> The
                  exact figure never leaves the phone — it is rounded before the
                  request is built, and rounded again on arrival.
                </li>
                <li>
                  <span className="font-semibold">No name and no device.</span> The
                  id is a random string made for this session and thrown away
                  when you leave this screen. It is not the one the demo room
                  uses, so the two cannot be joined.
                </li>
                <li>
                  <span className="font-semibold">Nothing older than two minutes.</span> Old
                  points are deleted on the next write, not left for a job that
                  might not run. There is no history to ask for.
                </li>
                <li>
                  <span className="font-semibold">Never remembered.</span> This
                  switch is off every time you open the app. It does not resume.
                </li>
                <li>
                  What you get back is points and nothing else: no ids, no
                  times, no speeds, no directions. There is nothing in the
                  reply that would let you follow somebody.
                </li>
              </ul>
            </Details>
          </Card>

          <p className="px-1 text-[11px] leading-relaxed text-slate-500">
            Red lines are the 48 officially designated accident-prone stretches,
            drawn from geometry stored in the app. Green dots are hospitals and
            police stations. Amber is a hazard another rider reported. None of
            it needs a signal — only the blue dots do.
          </p>
        </>
      )}
    </div>
  )
}
