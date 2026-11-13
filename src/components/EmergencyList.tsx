import type { NearbyPlace } from '../lib/risk'

/** Where to get help along this corridor. Phone numbers are tap-to-call, which
 *  is the whole point of this living on a phone rather than a slide. */
export function EmergencyList({
  hospitals,
  police,
}: {
  hospitals: NearbyPlace[]
  police: NearbyPlace[]
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">If something happens on the way</h2>

      <div className="mt-3 flex gap-2">
        <a
          href="tel:114"
          className="flex-1 rounded-xl bg-red-600 px-3 py-3 text-center text-sm font-semibold text-white active:bg-red-700"
        >
          Ambulance 114
        </a>
        <a
          href="tel:999"
          className="flex-1 rounded-xl bg-slate-800 px-3 py-3 text-center text-sm font-semibold text-white active:bg-slate-900"
        >
          Police 999
        </a>
      </div>

      <Group title="Nearest medical help" places={hospitals} />
      <Group title="Nearest police stations" places={police} />

      <p className="mt-3 text-[11px] text-slate-500">
        Distances are from the straight line between your two towns, not road distance.
      </p>
    </section>
  )
}

function Group({ title, places }: { title: string; places: NearbyPlace[] }) {
  if (!places.length) return null
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="mt-2 space-y-2">
        {places.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {p.kind === 'hospital' ? 'Hospital' : p.kind === 'police' ? p.category : p.category}
                {p.town ? ` · ${p.town}` : ''} · {p.detourKm.toFixed(1)} km off route
              </p>
            </div>
            {p.phone && (
              <a
                href={`tel:${p.phone}`}
                aria-label={`Call ${p.name}`}
                className="shrink-0 rounded-lg bg-brand-deep px-3 py-2 text-xs font-semibold text-white active:bg-brand-deep/90"
              >
                Call
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
