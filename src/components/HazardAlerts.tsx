import { hazardsFor, LEVEL_LABEL, OFFICIAL_SOURCE, type Hazard } from '../lib/hazards'
import { hoursOverTrip, type LiveConditions } from '../lib/live'
import type { TravelMode } from '../lib/types'

const TONE: Record<Hazard['level'], { box: string; chip: string }> = {
  advisory: { box: 'bg-slate-50 ring-slate-200', chip: 'bg-slate-200 text-slate-700' },
  serious: { box: 'bg-amber-50 ring-amber-200', chip: 'bg-flag-yellow/30 text-amber-900' },
  severe: { box: 'bg-flag-red/10 ring-flag-red/30', chip: 'bg-flag-red text-white' },
}

/**
 * Weather that is dangerous in itself, over the hours of this trip.
 *
 * Shown above the score because it is a different kind of claim. The score
 * is years of recorded exposure; this is "a storm is coming through while
 * you are out in it", and the right response to it is to not go.
 *
 * It is scrupulously not presented as an official warning. Only the
 * Mauritius Meteorological Services declares a cyclone class, we cannot see
 * their bulletins, and the panel says so and links to them. Riders act on
 * these things, so the provenance has to be as clear as it is on the score.
 */
export function HazardAlerts({
  live,
  departAt,
  tripMinutes,
  mode,
}: {
  live: LiveConditions
  departAt: Date
  tripMinutes: number
  mode: TravelMode
}) {
  const hours = hoursOverTrip(live, departAt, tripMinutes)
  const hazards = hazardsFor(hours, mode)
  if (hazards.length === 0) return null

  const worst = hazards.some((h) => h.level === 'severe')
    ? 'severe'
    : hazards.some((h) => h.level === 'serious')
      ? 'serious'
      : 'advisory'

  return (
    <section className={`rounded-2xl p-4 ring-1 ${TONE[worst].box}`}>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Conditions on this corridor</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[worst].chip}`}
        >
          {LEVEL_LABEL[worst]}
        </span>
      </div>

      <ul className="mt-3 space-y-2.5">
        {hazards.map((h) => (
          <li key={h.id} className="rounded-xl bg-white/70 p-3 ring-1 ring-black/5">
            <p className="text-sm font-semibold text-slate-900">{h.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">{h.detail}</p>
            <p className="mt-1.5 text-xs font-medium leading-relaxed text-slate-900">
              {h.action}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        {OFFICIAL_SOURCE.note}{' '}
        <a
          href={OFFICIAL_SOURCE.url}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-brand-deep underline"
        >
          {OFFICIAL_SOURCE.name}
        </a>
      </p>
    </section>
  )
}
