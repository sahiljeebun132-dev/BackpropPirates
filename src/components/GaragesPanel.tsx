import { useState } from 'react'

import { GARAGE_KIND_LABEL, useGarages, type Garage } from '../lib/useGarages'

type Props = {
  lat: number
  lon: number
  /** Loaded only once the rider is on a screen that needs it. */
  enabled: boolean
  usingGps: boolean
  onUseGps: () => void
}

type Filter = 'help' | 'fuel'

/** Garages, tyre shops and filling stations near where the car stopped.
 *
 *  This is OpenStreetMap, not an official register: Mauritius publishes no
 *  list of mechanics, and scraping a business directory would mean putting
 *  unverified numbers in front of someone stranded at night. Community data,
 *  openly licensed and traceable, is the honest option, and the panel says so
 *  rather than presenting it as authoritative.
 */
export function GaragesPanel({ lat, lon, enabled, usingGps, onUseGps }: Props) {
  const { nearest, source, total } = useGarages(enabled, lat, lon)
  const [filter, setFilter] = useState<Filter>('help')

  const matches = nearest.filter((g) =>
    filter === 'fuel' ? g.kind === 'fuel' : g.kind !== 'fuel',
  )
  const shown = matches.slice(0, 5)

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">Garages and fuel nearby</h2>

      {total === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          The garage list has not loaded. The emergency numbers above still work, and so does
          everything else on this page.
        </p>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            {(['help', 'fuel'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium ring-1 transition ${
                  filter === f
                    ? 'bg-brand-deep text-white ring-brand-deep'
                    : 'bg-slate-50 text-slate-700 ring-slate-200 active:bg-slate-100'
                }`}
              >
                {f === 'help' ? 'Garages and tyres' : 'Filling stations'}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">Nothing of that kind mapped nearby.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {shown.map((g) => (
                <GarageRow key={g.id} garage={g} />
              ))}
            </ul>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            {usingGps ? 'Measured from where you are now. ' : (
              <>
                Measured from the town you picked.{' '}
                <button type="button" onClick={onUseGps} className="font-semibold text-brand-deep underline">
                  Use my location
                </button>{' '}
              </>
            )}
            {source
              ? `${total} places from ${source.name}, ${source.licence}. Community-maintained, not an official register — numbers and opening hours can be out of date, so ring before you set off to one.`
              : ''}
          </p>
        </>
      )}
    </section>
  )
}

function GarageRow({ garage }: { garage: Garage & { km: number } }) {
  const where = [garage.street, garage.town].filter(Boolean).join(', ')
  return (
    <li className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{garage.name}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {GARAGE_KIND_LABEL[garage.kind]} · {garage.km.toFixed(1)} km
          {where ? ` · ${where}` : ''}
        </p>
        {garage.hours && (
          <p className="mt-0.5 truncate text-[11px] text-slate-500">Listed hours: {garage.hours}</p>
        )}
      </div>
      {garage.phone ? (
        <a
          href={`tel:${garage.phone}`}
          aria-label={`Call ${garage.name}`}
          className="shrink-0 rounded-lg bg-brand-deep px-3 py-2 text-xs font-semibold text-white active:bg-brand-deep/90"
        >
          Call
        </a>
      ) : (
        <span className="shrink-0 text-[11px] text-slate-400">No number</span>
      )}
    </li>
  )
}
