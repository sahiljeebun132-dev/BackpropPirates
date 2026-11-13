import { useMemo, useState } from 'react'

import { AppShell } from './components/AppShell'
import { IslandContext } from './components/IslandContext'
import { PlanForm } from './components/PlanForm'
import { RouteResult } from './components/RouteResult'
import { SourcesPanel } from './components/SourcesPanel'
import { planDeparture } from './lib/departure'
import { lightBandAt } from './lib/live'
import { assessRoute } from './lib/risk'
import type { TimeBand, TravelMode } from './lib/types'
import { useAppData } from './lib/useAppData'
import { useLive } from './lib/useLive'

/** Which half of the app is on screen. Plain state rather than a router, so
 *  there is one less thing to break during a demo. */
type View = 'plan' | 'result'

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
      {view === 'result' && assessment ? (
        <RouteResult
          assessment={assessment}
          data={appData}
          live={liveConditions}
          departureAdvice={departureAdvice}
          departAt={departAt}
          onDepartAt={(d) => {
            setDepartAt(d)
            setDepartIsNow(false)
          }}
          onBack={() => setView('plan')}
        />
      ) : (
        <>
          <IslandContext data={appData} />
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
          <SourcesPanel data={appData} />
        </>
      )}
    </AppShell>
  )
}
