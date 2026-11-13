import type { AppData } from '../lib/types'

/** The reason this app exists, in three real numbers. */
export function IslandContext({ data }: { data: AppData }) {
  const { island, exposure } = data
  const stats = [
    { value: island.fatal?.toLocaleString() ?? '—', label: `killed on the roads in ${island.year}` },
    { value: island.casualties.toLocaleString(), label: 'people injured or killed' },
    {
      value: `${Math.round(exposure.vulnerableShare * 100)}%`,
      label: 'of them on two wheels or on foot',
    },
  ]

  return (
    <section className="rounded-2xl bg-slate-900 p-4 text-white shadow-sm">
      <div className="grid grid-cols-3 gap-2 text-center">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-2xl font-bold tabular-nums leading-none">{s.value}</p>
            <p className="mt-1.5 text-[11px] leading-tight text-slate-300">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-400">
        Republic of Mauritius, {island.year}. Statistics Mauritius via data.govmu.org.
      </p>
    </section>
  )
}
