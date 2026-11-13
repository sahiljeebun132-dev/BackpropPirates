import { useMemo, useState } from 'react'

import { AppShell } from './components/AppShell'
import { IslandContext } from './components/IslandContext'
import { PlanForm } from './components/PlanForm'
import { RouteResult } from './components/RouteResult'
import { SourcesPanel } from './components/SourcesPanel'
import { assessRoute } from './lib/risk'
import type { TimeBand, TravelMode } from './lib/types'
import { useAppData } from './lib/useAppData'

/** Which half of the app is on screen. Kept as plain state rather than a router
 *  so there is one less thing to break during a demo. */
type View = 'plan' | 'result'

export default function App() {
  const state = useAppData()

  const [origin, setOrigin] = useState('grand-baie')
  const [destination, setDestination] = useState('port-louis')
  const [mode, setMode] = useState<TravelMode>('motorcycle')
  const [timeBand, setTimeBand] = useState<TimeBand>('night-unlit')
  const [view, setView] = useState<View>('plan')

  const data = state.status === 'ready' ? state.data : null

  const assessment = useMemo(() => {
    if (!data) return null
    const from = data.places.places.find((p) => p.id === origin)
    const to = data.places.places.find((p) => p.id === destination)
    if (!from || !to || from.id === to.id) return null
    return assessRoute(data, from, to, mode, timeBand)
  }, [data, origin, destination, mode, timeBand])

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
        <RouteResult assessment={assessment} data={appData} onBack={() => setView('plan')} />
      ) : (
        <>
          <IslandContext data={appData} />
          <PlanForm
            places={appData.places.places}
            origin={origin}
            destination={destination}
            mode={mode}
            timeBand={timeBand}
            onOrigin={setOrigin}
            onDestination={setDestination}
            onMode={setMode}
            onTimeBand={setTimeBand}
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
