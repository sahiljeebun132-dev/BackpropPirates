import { useState } from 'react'

import { WEIGHTS, type Factor } from '../lib/risk'

/** Shows what each factor contributed, and on tap, the figures behind it.
 *  The judges' first question is "where does the number come from" — this is
 *  the answer, in the app rather than in the pitch. */
export function FactorBreakdown({ factors }: { factors: Factor[] }) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">How the score was built</h2>
      <p className="mt-1 text-xs text-slate-500">
        Four measurements, each taken from a published government table. Tap one to see the
        figures.
      </p>

      <ul className="mt-3 divide-y divide-slate-100">
        {factors.map((f) => {
          const isOpen = open === f.key
          const points = Math.round(f.risk * f.weight * 100)
          return (
            <li key={f.key} className="py-3">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : f.key)}
                aria-expanded={isOpen}
                className="w-full text-left"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-slate-900">{f.label}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                    −{points} pts
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${Math.max(2, f.risk * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400">
                    {Math.round(f.weight * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{f.headline}</p>
              </button>

              {isOpen && (
                <div className="mt-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="text-xs leading-relaxed text-slate-700">{f.detail}</p>
                  <p className="mt-2 text-[11px] text-slate-500">Source: {f.source}</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
        Weights are ours: accident-prone segments {Math.round(WEIGHTS.hotspots * 100)}%, district
        casualty volume {Math.round(WEIGHTS.district * 100)}%, risk to your travel group{' '}
        {Math.round(WEIGHTS.mode * 100)}%, light conditions {Math.round(WEIGHTS.time * 100)}%.
        Everything they multiply comes from the data. The score shows recorded exposure, not a
        prediction about today.
      </p>
    </section>
  )
}
