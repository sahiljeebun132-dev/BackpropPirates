import { useState } from 'react'

import type { AppData } from '../lib/types'

/**
 * The raw rows, on the phone, for anyone who wants to check.
 *
 * The app says everywhere that each figure comes from a published table. That
 * is a claim, and a claim a judge should be able to test in the ten minutes
 * they have rather than by downloading a CSV afterwards. This opens the
 * actual arrays the app scored from — the same objects, not a prettied
 * summary — so "where does 31 come from" can be answered by scrolling.
 *
 * It reads what is already in memory. No request, so it works in airplane
 * mode alongside everything else, which is also the point: the tables are on
 * the device, which is why the score is.
 *
 * Rows are capped per table. Showing all 241 emergency places would bury the
 * thing someone is looking for, and the count is always stated so the cap is
 * visible rather than silently truncating.
 */

const SHOW = 12

type Table = { key: string; label: string; rows: unknown[]; file: string }

function tablesOf(data: AppData): Table[] {
  return [
    { key: 'hotspots', label: 'Accident-prone segments', rows: data.hotspots.hotspots, file: 'hotspots.json' },
    { key: 'districts', label: 'Casualties by police district', rows: data.districts.districts, file: 'districts.json' },
    { key: 'light', label: 'Casualties by light condition', rows: data.conditions.light.conditions, file: 'conditions.json' },
    { key: 'places', label: 'Towns', rows: data.places.places, file: 'places.json' },
    { key: 'emergency', label: 'Hospitals and police stations', rows: data.emergency.places, file: 'emergency.json' },
  ]
}

/** One row as the few fields that identify it, not every key it carries.
 *  A hotspot's 40-point geometry array is true and useless on a phone. */
function summarise(row: unknown): string {
  if (row === null || typeof row !== 'object') return String(row)
  const o = row as Record<string, unknown>
  const parts: string[] = []
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      parts.push(`${k}: [${v.length}]`)
      continue
    }
    if (typeof v === 'object') continue
    const text = typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : String(v)
    if (text.length > 44) continue
    parts.push(`${k}: ${text}`)
    if (parts.length >= 6) break
  }
  return parts.join(' · ')
}

export function DatasetExplorer({ data }: { data: AppData }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const tables = tablesOf(data)

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Inspect the rows
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        The arrays the score was computed from, read out of the app&rsquo;s own memory. Nothing
        is fetched, so this works with no signal too.
      </p>

      <div className="mt-2 space-y-1.5">
        {tables.map((t) => {
          const open = openKey === t.key
          return (
            <div key={t.key} className="rounded-xl bg-slate-50 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setOpenKey(open ? null : t.key)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-slate-800">
                    {t.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {t.rows.length.toLocaleString('en-GB')} rows · {t.file}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-brand-deep">
                  {open ? 'Hide' : 'Open'}
                </span>
              </button>

              {open && (
                <div className="border-t border-slate-200 px-3 py-2">
                  <ol className="space-y-1">
                    {t.rows.slice(0, SHOW).map((row, i) => (
                      <li
                        key={i}
                        className="tabular break-words text-[10.5px] leading-relaxed text-slate-600"
                      >
                        {summarise(row)}
                      </li>
                    ))}
                  </ol>
                  {t.rows.length > SHOW && (
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Showing the first {SHOW} of {t.rows.length.toLocaleString('en-GB')}. The
                      whole file ships with the app at <span className="tabular">/data/{t.file}</span>.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
