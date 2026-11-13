import { useMemo, useState } from 'react'

import { AppShell } from './components/AppShell'
import { BreakdownFlow } from './components/BreakdownFlow'
import { CrashWatch } from './components/CrashWatch'
import { FirstRunPermissions } from './components/FirstRunPermissions'
import { IslandContext } from './components/IslandContext'
import { PlanForm } from './components/PlanForm'
import { RouteResult } from './components/RouteResult'
import { SourcesPanel } from './components/SourcesPanel'
import { planDeparture } from './lib/departure'
import { lightBandAt } from './lib/live'
import { assessRoute } from './lib/risk'
import type { TimeBand, TravelMode } from './lib/types'
import { useAppData } from './lib/useAppData'
import { useGeolocation } from './lib/useGeolocation'
import { useLive } from './lib/useLive'
import { useReports } from './lib/useReports'

/** Which half of the app is on screen. Plain state rather than a router, so
 *  there is one less thing to break during a demo. */
type View = 'plan' | 'result' | 'help'

export default function App() {
  const state = useAppData()

  const [origin, setOrigin] = useState('grand-baie')
  const [destination, setDestination] = useState('port-louis')
  const [mode, setMode] = useState<TravelMode>('motorcycle')
  const [departAt, setDepartAt] = useState(() => new Date())
  const [departIsNow, setDepartIsNow] = useState(true)
  const [roadIsLit, setRoadIsLit] = useState(false)
  const [fallbackBand, setFallbackBand] = useState<TimeBand>('night-unlit')
  const [view, setView] = useState<View>('plan')

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
      ) : (
        <>
          {/* First launch only, and before anything else on the screen: the
              permissions it asks for are useless if they are first requested
              during a crash. */}
          <FirstRunPermissions />

          <IslandContext data={appData} />

          <button
            type="button"
            onClick={() => setView('help')}
            className="flex w-full items-center gap-3 rounded-2xl bg-flag-red px-4 py-3.5 text-left text-white shadow-sm active:bg-flag-red/90"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6 shrink-0">
              <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              <span className="block text-sm font-bold">Broken down or had a crash?</span>
              <span className="block text-xs text-white/85">Safety check first, then what to do</span>
            </span>
          </button>
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
          <CrashWatch />
          <SourcesPanel data={appData} />
        </>
      )}
    </AppShell>
  )
}
