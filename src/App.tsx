import { useEffect, useMemo, useState } from 'react'

import { AppShell } from './components/AppShell'
import { AssistantPage } from './components/AssistantPage'
import { BreakdownFlow } from './components/BreakdownFlow'
import { CrashWatch } from './components/CrashWatch'
import { LegalPanel } from './components/LegalPanel'
import { OfflineBanner } from './components/OfflineBanner'
import { FirstRunPermissions } from './components/FirstRunPermissions'
import { InstallApp } from './components/InstallApp'
import { HandsFree } from './components/HandsFree'
import { HomeDashboard } from './components/HomeDashboard'
import { IslandMap } from './components/IslandMap'
import { LiveConditionsPanel, LiveUnavailable } from './components/LiveConditions'
import { HotspotList } from './components/HotspotList'
import { IslandContext } from './components/IslandContext'
import { PlanForm } from './components/PlanForm'
import { ReportByVoice } from './components/ReportByVoice'
import { RideLive } from './components/RideLive'
import { RoadScanner } from './components/RoadScanner'
import { RouteResult } from './components/RouteResult'
import { SourcesPanel } from './components/SourcesPanel'
import { PageHeader } from './components/ui'
import { planDeparture } from './lib/departure'
import { lightBandAt } from './lib/live'
import { assessRoute } from './lib/risk'
import { applyScanPref } from './lib/roadScan'
import type { TimeBand, TravelMode } from './lib/types'
import { useAppData } from './lib/useAppData'
import { useGeolocation } from './lib/useGeolocation'
import { useLive } from './lib/useLive'
import { useReports } from './lib/useReports'

/** Which half of the app is on screen. Plain state rather than a router, so
 *  there is one less thing to break during a demo. */
type View =
  | 'plan'
  | 'result'
  | 'help'
  | 'accidents'
  | 'climate'
  | 'crash'
  | 'ask'
  | 'scanner'
  | 'listen'
  | 'live'
  | 'speak'

export default function App() {
  const state = useAppData()

  // The road scanner's switch lives in this phone's storage; the service
  // keeps its own copy and loses it every time Android restarts the
  // process. Pushed back on every start rather than only when the scanner
  // screen is opened, because a rider who switched it on last week arms
  // crash watch from the home row and never visits that screen again —
  // and a scanner that silently stopped scanning is the worst version of
  // this feature.
  useEffect(() => {
    void applyScanPref()
  }, [])

  const [origin, setOrigin] = useState('grand-baie')
  const [destination, setDestination] = useState('port-louis')
  const [mode, setMode] = useState<TravelMode>('motorcycle')
  const [departAt, setDepartAt] = useState(() => new Date())
  const [departIsNow, setDepartIsNow] = useState(true)
  const [roadIsLit, setRoadIsLit] = useState(false)
  const [fallbackBand, setFallbackBand] = useState<TimeBand>('night-unlit')
  const [view, setView] = useState<View>('plan')

  // Open a page and you should be at the top of it. The scroll container is
  // shared by every screen, so without this a tall home screen left you nine
  // hundred pixels down a page you had only just opened, with the header —
  // the one thing that says where you are — off screen above you.
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [view])

  // The system back button goes up a screen rather than out of the app.
  // MainActivity calls this and only closes the activity when it returns
  // false, which is to say when there is nowhere left to go.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__zetwayBack = () => {
      if (view !== 'plan') {
        setView('plan')
        return true
      }
      return false
    }
    return () => {
      delete w.__zetwayBack
    }
  }, [view])

  const data = state.status === 'ready' ? state.data : null

  const [from, to] = useMemo(() => {
    if (!data) return [null, null]
    return [
      data.places.places.find((p) => p.id === origin) ?? null,
      data.places.places.find((p) => p.id === destination) ?? null,
    ]
  }, [data, origin, destination])

  // One forecast for the middle of the corridor. The weather grid is far
  // coarser than the gap between two Mauritian towns, so one point will do.
  const mid = from && to ? { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 } : null
  const live = useLive(mid?.lat ?? null, mid?.lon ?? null)
  const liveConditions = live.status === 'ready' ? live.conditions : null

  // Hazard reports are pulled around the middle of the corridor, with a radius
  // wide enough to cover the whole of it.
  const corridorKm =
    from && to
      ? Math.hypot((from.lat - to.lat) * 110.57, (from.lon - to.lon) * 104.4)
      : 0
  const reportRadiusKm = Math.max(8, Math.round(corridorKm / 2 + 3))
  const reports = useReports(mid?.lat ?? null, mid?.lon ?? null, reportRadiusKm)
  const gps = useGeolocation()

  // Sunrise and sunset decide the light band. Without a forecast we fall back
  // to whatever the rider picked by hand.
  const band: TimeBand = liveConditions
    ? lightBandAt(liveConditions, departAt, roadIsLit).band
    : fallbackBand

  /** The amber strip on the home screen, or nothing.
   *
   *  The supplied design hard-codes a weather warning into the layout. A
   *  warning that is on screen every time the app opens is one nobody reads,
   *  and this one would also be invented. So it is derived from the forecast
   *  already fetched for the corridor, names the window it covers, and is
   *  null whenever the next few hours are clear. */
  const vigilance = useMemo(() => {
    if (!liveConditions) return null
    const now = departAt.getTime()
    const soon = liveConditions.hourly.filter(
      (h) => h.time.getTime() >= now && h.time.getTime() <= now + 6 * 3600_000,
    )
    if (soon.length === 0) return null

    const wettest = Math.max(...soon.map((h) => h.precipitationMm))
    const gust = Math.max(...soon.map((h) => h.windGustKmh ?? 0))
    const fog = soon.some((h) => h.visibilityM !== null && h.visibilityM < 1000)

    if (fog) return 'Visibility under 1 km forecast on this corridor in the next few hours.'
    if (wettest >= 4) return `Heavy rain forecast on this corridor, up to ${wettest.toFixed(1)} mm in an hour.`
    if (wettest >= 1) return `Rain forecast on this corridor in the next few hours.`
    if (gust >= 50) return `Gusts to ${Math.round(gust)} km/h forecast on this corridor.`
    return null
  }, [liveConditions, departAt])

  const assessment = useMemo(() => {
    if (!data || !from || !to || from.id === to.id) return null
    return assessRoute(data, from, to, mode, band)
  }, [data, from, to, mode, band])

  const departureAdvice = useMemo(() => {
    if (!data || !from || !to || from.id === to.id || !liveConditions) return null
    return planDeparture(data, from, to, mode, liveConditions, departAt, roadIsLit)
  }, [data, from, to, mode, liveConditions, departAt, roadIsLit])

  if (state.status === 'loading') {
    return (
      <AppShell>
        <p className="py-12 text-center text-sm text-slate-500">Loading road safety data…</p>
      </AppShell>
    )
  }

  if (state.status === 'error') {
    return (
      <AppShell>
        <section className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200">
          <h2 className="text-sm font-semibold text-red-900">Could not load the data</h2>
          <p className="mt-1 text-sm text-red-800">{state.message}</p>
        </section>
      </AppShell>
    )
  }

  const appData = state.data

  return (
    <AppShell>
      {view === 'help' && from ? (
        <BreakdownFlow
          // Inherit what they picked on the planner rather than asking twice.
          defaultVehicle={mode === 'motorcycle' ? 'motorcycle' : 'car'}
          data={appData}
          position={gps.position}
          onUseGps={gps.request}
          fallbackPlace={from}
          isDark={band === 'night-lit' || band === 'night-unlit'}
          onBack={() => setView('plan')}
        />
      ) : view === 'result' && assessment ? (
        <RouteResult
          assessment={assessment}
          data={appData}
          live={liveConditions}
          liveFailed={live.status === 'error'}
          departureAdvice={departureAdvice}
          reports={reports.reports}
          reportsStatus={reports.status}
          onReported={reports.refresh}
          reportAt={gps.position ?? mid ?? { lat: 0, lon: 0 }}
          usingGps={gps.position !== null}
          onUseGps={gps.request}
          reportRadiusKm={reportRadiusKm}
          departAt={departAt}
          onDepartAt={(d) => {
            setDepartAt(d)
            setDepartIsNow(false)
          }}
          onBack={() => setView('plan')}
        />
      ) : view === 'ask' ? (
        <AssistantPage
          data={appData}
          onBack={() => setView('plan')}
          onGo={(t) => {
            // The engine answers with place ids and a view; the app owns the
            // state, so set the trip first and only then switch screens.
            if (t.originId) setOrigin(t.originId)
            if (t.destinationId) setDestination(t.destinationId)
            // The roadside flow reads its default vehicle from the planner's
            // mode, so setting that is how "my bike has a puncture" arrives
            // in the guides as a bike without asking twice.
            if (t.mode) setMode(t.mode)
            else if (t.vehicle) setMode(t.vehicle === 'motorcycle' ? 'motorcycle' : 'car')
            setView(t.view)
          }}
        />
      ) : view === 'speak' ? (
        <ReportByVoice
          data={appData}
          position={gps.position}
          onPosted={() => reports.refresh()}
          onClose={() => setView('plan')}
        />
      ) : view === 'live' ? (
        <RideLive
          data={appData}
          reports={reports.reports}
          position={gps.position}
          origin={from}
          destination={to}
          onUseGps={gps.request}
          onBack={() => setView('plan')}
        />
      ) : view === 'listen' ? (
        <HandsFree onBack={() => setView('plan')} />
      ) : view === 'scanner' ? (
        <RoadScanner
          reports={reports.reports}
          reportsStatus={reports.status}
          position={gps.position}
          onUseGps={gps.request}
          onBack={() => setView('plan')}
        />
      ) : view === 'accidents' ? (
        <>
          <PageHeader title="Accidents & road safety" onBack={() => setView('plan')} />
          <IslandContext data={appData} />
          <IslandMap data={appData} />
          <HotspotList
            hotspots={appData.hotspots.hotspots.map((h) => ({ ...h, detourKm: 0 }))}
            totalOnIsland={appData.hotspots.hotspots.length}
            radiusKm={appData.hotspots.corridorRadiusKm}
          />
          <SourcesPanel data={appData} />
        </>
      ) : view === 'climate' ? (
        <>
          <PageHeader title="Climate & vigilance" onBack={() => setView('plan')} />
          {liveConditions && departureAdvice && from && to ? (
            <LiveConditionsPanel
              data={appData}
              live={liveConditions}
              advice={departureAdvice}
              departAt={departAt}
              directKm={corridorKm}
              onAccept={(d: Date) => {
                setDepartAt(d)
                setDepartIsNow(false)
              }}
            />
          ) : (
            <LiveUnavailable band={band} onChange={() => setView('plan')} />
          )}
          <SourcesPanel data={appData} />
        </>
      ) : view === 'plan' ? (
        <>
          {/* Before anything else: if there is no signal, say so and say what
              still works, rather than letting the rider find out by tapping. */}
          <OfflineBanner liveFailed={live.status === 'error'} />

          {/* First launch only, and before anything else on the screen: the
              permissions it asks for are useless if they are first requested
              during a crash. */}
          <FirstRunPermissions />

          <HomeDashboard
            vigilance={vigilance}
            onAccidents={() => setView('accidents')}
            onClimate={() => setView('climate')}
            onReport={() => setView('speak')}
            onRoadside={() => setView('help')}
            onAsk={() => setView('ask')}
            onListen={() => setView('listen')}
            onLive={() => setView('live')}
            planner={
              <PlanForm
                places={appData.places.places}
                origin={origin}
                destination={destination}
                mode={mode}
                departAt={departAt}
                departIsNow={departIsNow}
                roadIsLit={roadIsLit}
                fallbackBand={fallbackBand}
                liveFailed={live.status === 'error'}
                onOrigin={setOrigin}
                onDestination={setDestination}
                onMode={setMode}
                onDepartAt={(d, isNow = false) => {
                  setDepartAt(d)
                  setDepartIsNow(isNow)
                }}
                onRoadIsLit={setRoadIsLit}
                onFallbackBand={setFallbackBand}
                onSwap={() => {
                  setOrigin(destination)
                  setDestination(origin)
                }}
                onSubmit={() => setView('result')}
                sameEndpoints={origin === destination}
              />
            }
          />
        </>
      ) : null}

      {/* Mounted for the whole session, never torn down by navigation, and
          shown as a line on home or a page of its own. Hidden elsewhere
          rather than unmounted, so the sensor listener and the armed state
          survive a trip through the roadside guides. */}
      <div className={view === 'plan' || view === 'crash' ? 'contents' : 'hidden'}>
        {/* The heading and the scanner row are free to come and go; only
            CrashWatch has to persist, so only it sits outside the branch. */}
        {/* The road scanner is built and works, but it is not part of what
            this is for today, and a rider does not need a second background
            job offered to them on the way to the one that matters. The
            'scanner' view still exists; nothing on the home screen points at
            it. */}
        <CrashWatch
          expanded={view === 'crash'}
          onOpen={() => setView('crash')}
          onBack={() => setView('plan')}
        />
      </div>

      {view === 'plan' && (
        <>
          {/* Under crash watch, because that line has just promised
              background detection and this says which build delivers it.
              Null inside the APK. */}
          <InstallApp />
          {/* The sources panel is on all three screens that actually show a
              figure — the result, accidents and climate. Home shows none, so
              "every figure comes from one of these tables" had nothing on
              screen to attach to, and it sat directly under the legal panel,
              which names the same publishers. */}
          <LegalPanel />
        </>
      )}
    </AppShell>
  )
}
