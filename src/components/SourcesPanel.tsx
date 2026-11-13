import { useState } from 'react'

import type { AppData, Source } from '../lib/types'
import { DatasetExplorer } from './DatasetExplorer'

/** Every table behind the app, with its data.govmu.org link. Rule 4 says the
 *  dataset must power a feature; this shows which feature each one powers. */
export function SourcesPanel({ data }: { data: AppData }) {
  const [open, setOpen] = useState(false)

  const used: { source: Source; powers: string }[] = [
    { source: data.hotspots.sources[0], powers: 'Accident-prone stretches on your corridor' },
    { source: data.districts.sources[0], powers: 'District casualty volume and who gets hurt' },
    { source: data.conditions.sources[0], powers: 'Light conditions and fatality share' },
    { source: data.conditions.sources[1], powers: 'Junction warnings' },
    { source: data.conditions.sources[2], powers: 'Road type and pedestrian collisions' },
    { source: data.emergency.sources[0], powers: 'Hospitals and health centres, and town coordinates' },
    { source: data.emergency.sources[1], powers: 'Police stations' },
    { source: data.exposure.sources[0], powers: 'Vehicles registered, the exposure denominator' },
    { source: data.island.sources[0], powers: 'Island-wide totals' },
  ].filter((e) => e.source)

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">
          Data sources ({used.length})
        </span>
        <span className="text-xs text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>

      <p className="mt-1 text-xs text-slate-500">
        Every figure in this app comes from one of these published tables. No estimates, no
        placeholders.
      </p>

      {open && (
        <ul className="mt-3 space-y-3">
          {used.map((e, i) => (
            <li key={i} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="text-sm font-medium leading-snug text-slate-900">{e.source.dataset}</p>
              <p className="mt-1 text-xs text-slate-600">Powers: {e.powers}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {e.source.publisher} · {e.source.licence}
                {e.source.rows ? ` · ${e.source.rows} rows` : ''}
              </p>
              {e.source.url && (
                <a
                  href={e.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block break-all text-[11px] font-medium text-brand-deep underline"
                >
                  {e.source.resource ?? 'Open source file'}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Naming the table is the claim; showing the rows is the evidence.
          Folded into the same disclosure so it costs nothing when closed. */}
      {open && <DatasetExplorer data={data} />}
    </section>
  )
}
