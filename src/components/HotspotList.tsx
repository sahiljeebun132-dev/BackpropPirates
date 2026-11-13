import type { Hotspot } from '../lib/types'

type Props = {
  hotspots: (Hotspot & { detourKm: number })[]
  totalOnIsland: number
  radiusKm: number
}

export function HotspotList({ hotspots, totalOnIsland, radiusKm }: Props) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Accident-prone stretches</h2>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {hotspots.length} of {totalOnIsland}
        </span>
      </div>

      {hotspots.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          None of the island&rsquo;s {totalOnIsland} designated accident-prone segments lie within{' '}
          {radiusKm} km of this corridor.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            Segments the authorities have designated accident-prone, within {radiusKm} km of your
            corridor. Closest first.
          </p>
          <ul className="mt-3 space-y-2">
            {hotspots.map((h) => (
              <li key={h.id} className="flex gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                {h.road && (
                  <span className="flex h-7 shrink-0 items-center rounded-md bg-slate-800 px-2 text-xs font-bold text-white">
                    {h.road}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug text-slate-900">{h.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {h.lengthKm} km stretch &middot; {h.detourKm < 0.1 ? 'on your route' : `${h.detourKm.toFixed(1)} km off the direct line`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
