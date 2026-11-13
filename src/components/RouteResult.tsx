import type { DepartureAdvice } from '../lib/departure'
import type { LiveConditions } from '../lib/live'
import { MODE_LABEL, TIME_BAND_LABEL, type RouteAssessment } from '../lib/risk'
import type { HazardReport } from '../lib/reports'
import type { AppData } from '../lib/types'
import { AdviceList } from './AdviceList'
import { EmergencyList } from './EmergencyList'
import { FactorBreakdown } from './FactorBreakdown'
import { HotspotList } from './HotspotList'
import { LiveConditionsPanel, LiveUnavailable } from './LiveConditions'
import { LiveAlertBanner, LiveReports } from './LiveReports'
import { ScoreDial } from './ScoreDial'
import { SourcesPanel } from './SourcesPanel'

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', hour: '2-digit', minute: '2-digit',
})

export function RouteResult({
  assessment,
  data,
  live,
  liveFailed,
  departureAdvice,
  departAt,
  onDepartAt,
  reports,
  reportsStatus,
  onReported,
  reportAt,
  usingGps,
  onUseGps,
  reportRadiusKm,
  onBack,
}: {
  assessment: RouteAssessment
  data: AppData
  live: LiveConditions | null
  liveFailed: boolean
  departureAdvice: DepartureAdvice | null
  departAt: Date
  onDepartAt: (d: Date) => void
  reports: HazardReport[]
  reportsStatus: 'loading' | 'ready' | 'error'
  onReported: () => void
  reportAt: { lat: number; lon: number }
  usingGps: boolean
  onUseGps: () => void
  reportRadiusKm: number
  onBack: () => void
}) {
  const a = assessment
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-deep"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Change journey
      </button>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-base font-semibold leading-snug text-slate-900">
          {a.origin.name} <span className="text-slate-400">to</span> {a.destination.name}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {MODE_LABEL[a.mode]} · {timeFmt.format(departAt)} ·{' '}
          {TIME_BAND_LABEL[a.timeBand].toLowerCase()} · {a.directDistanceKm.toFixed(1)} km direct
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Police {a.districts.length === 1 ? 'district' : 'districts'}:{' '}
          {a.districts.map((d) => d.name).join(', ')}
        </p>
      </section>

      <LiveAlertBanner reports={reports} />

      <ScoreDial assessment={a} />

      {live && departureAdvice ? (
        <LiveConditionsPanel
          data={data}
          live={live}
          advice={departureAdvice}
          departAt={departAt}
          directKm={a.directDistanceKm}
          onAccept={onDepartAt}
        />
      ) : liveFailed ? (
        <LiveUnavailable band={a.timeBand} onChange={onBack} />
      ) : null}

      <LiveReports
        reports={reports}
        status={reportsStatus}
        reportAt={reportAt}
        usingGps={usingGps}
        radiusKm={reportRadiusKm}
        onReported={onReported}
        onUseGps={onUseGps}
      />

      <AdviceList advice={a.advice} />
      <FactorBreakdown factors={a.factors} />
      <HotspotList
        hotspots={a.hotspots}
        totalOnIsland={data.hotspots.hotspots.length}
        radiusKm={data.hotspots.corridorRadiusKm}
      />
      <EmergencyList hospitals={a.emergency.hospitals} police={a.emergency.police} />
      <SourcesPanel data={data} />
    </div>
  )
}
