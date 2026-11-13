import type { Advice } from '../lib/risk'

const STYLE = {
  critical: { box: 'bg-red-50 ring-red-200', dot: 'bg-red-600', label: 'Act on this' },
  warning: { box: 'bg-amber-50 ring-amber-200', dot: 'bg-amber-500', label: 'Take care' },
  info: { box: 'bg-slate-50 ring-slate-200', dot: 'bg-slate-400', label: 'Worth knowing' },
} as const

export function AdviceList({ advice }: { advice: Advice[] }) {
  if (!advice.length) return null

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">What to do about it</h2>
      <ul className="mt-3 space-y-2">
        {advice.map((a, i) => {
          const s = STYLE[a.severity]
          return (
            <li key={i} className={`rounded-xl p-3 ring-1 ${s.box}`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  {s.label}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-800">{a.text}</p>
              <p className="mt-1 text-[11px] text-slate-500">Based on: {a.basis}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
