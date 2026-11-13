import { MODE_LABEL, TIME_BAND_LABEL } from '../lib/risk'
import type { Place, TimeBand, TravelMode } from '../lib/types'

type Props = {
  places: Place[]
  origin: string
  destination: string
  mode: TravelMode
  timeBand: TimeBand
  onOrigin: (id: string) => void
  onDestination: (id: string) => void
  onMode: (m: TravelMode) => void
  onTimeBand: (t: TimeBand) => void
  onSubmit: () => void
  onSwap: () => void
  sameEndpoints: boolean
}

const MODES: TravelMode[] = ['car', 'motorcycle', 'bus', 'pedestrian']
const MODE_ICON: Record<TravelMode, string> = {
  car: 'M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13m-14 0h14m-14 0v4m14-4v4M7 17h.01M17 17h.01',
  motorcycle: 'M5 17a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm14 0a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm-9.5-2.5h5L17 9h2M9.5 14.5L12 9H8m6 0h2',
  bus: 'M5 15V6a2 2 0 012-2h10a2 2 0 012 2v9m-14 0h14m-14 0v2m14-2v2M6 11h12M7 15h.01M17 15h.01',
  pedestrian: 'M12 5.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM12 7v5m0 0l-2.5 7M12 12l2.5 7M9 10l3-1.5L15 10',
}
const TIME_BANDS: TimeBand[] = ['day', 'dawn-dusk', 'night-lit', 'night-unlit']

export function PlanForm(props: Props) {
  const {
    places, origin, destination, mode, timeBand,
    onOrigin, onDestination, onMode, onTimeBand, onSubmit, onSwap, sameEndpoints,
  } = props

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!sameEndpoints) onSubmit()
      }}
    >
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">Your journey</h2>

        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Starting from</span>
            <select
              value={origin}
              onChange={(e) => onOrigin(e.target.value)}
              className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-3 text-base text-slate-900 ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
            >
              {places.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={onSwap}
              aria-label="Swap origin and destination"
              className="-my-1 rounded-full bg-slate-100 p-2 text-slate-600 ring-1 ring-slate-200 active:bg-slate-200"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M7 4v13m0 0l-3-3m3 3l3-3M17 20V7m0 0l3 3m-3-3l-3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-500">Going to</span>
            <select
              value={destination}
              onChange={(e) => onDestination(e.target.value)}
              className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-3 text-base text-slate-900 ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
            >
              {places.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          {sameEndpoints && (
            <p role="alert" className="text-xs font-medium text-amber-700">
              Pick two different places.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">How are you travelling?</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {MODES.map((m) => {
            const active = m === mode
            return (
              <button
                key={m}
                type="button"
                aria-pressed={active}
                onClick={() => onMode(m)}
                className={`flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-medium ring-1 transition ${
                  active
                    ? 'bg-brand-deep text-white ring-brand-deep'
                    : 'bg-slate-50 text-slate-700 ring-slate-200 active:bg-slate-100'
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 shrink-0">
                  <path d={MODE_ICON[m]} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="leading-tight">{m === 'motorcycle' ? 'Motorcycle' : MODE_LABEL[m]}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Riders and people on foot are half of everyone hurt on Mauritian roads, so the score
          weighs them separately.
        </p>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">When?</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {TIME_BANDS.map((t) => {
            const active = t === timeBand
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => onTimeBand(t)}
                className={`rounded-xl px-3 py-3 text-sm font-medium ring-1 transition ${
                  active
                    ? 'bg-brand-deep text-white ring-brand-deep'
                    : 'bg-slate-50 text-slate-700 ring-slate-200 active:bg-slate-100'
                }`}
              >
                {TIME_BAND_LABEL[t]}
              </button>
            )
          })}
        </div>
      </section>

      <button
        type="submit"
        disabled={sameEndpoints}
        className="w-full rounded-2xl bg-brand-deep px-4 py-4 text-base font-semibold text-white shadow-sm active:bg-brand-deep/90 disabled:bg-slate-300"
      >
        Check this route
      </button>
    </form>
  )
}
