import type { RouteAssessment } from '../lib/risk'

const TONE = {
  good: { ring: '#15803d', bg: 'bg-green-50', text: 'text-green-800' },
  moderate: { ring: '#a16207', bg: 'bg-amber-50', text: 'text-amber-800' },
  high: { ring: '#c2410c', bg: 'bg-orange-50', text: 'text-orange-800' },
  severe: { ring: '#b91c1c', bg: 'bg-red-50', text: 'text-red-800' },
} as const

const SIZE = 168
const STROKE = 14
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R

export function ScoreDial({ assessment }: { assessment: RouteAssessment }) {
  const { score, band } = assessment
  const tone = TONE[band.tone]

  return (
    <section className={`rounded-2xl ${tone.bg} p-5 text-center shadow-sm ring-1 ring-slate-200`}>
      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Corridor safety score ${score} out of 100, ${band.label}`}
        >
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke="currentColor" strokeWidth={STROKE}
            className="text-slate-200"
          />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke={tone.ring} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - score / 100)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-bold tabular-nums text-slate-900">{score}</span>
          <span className="text-xs font-medium text-slate-500">out of 100</span>
        </div>
      </div>

      <p className={`mt-3 text-lg font-semibold ${tone.text}`}>{band.label}</p>
      <p className="mt-1 text-sm text-slate-600">
        Corridor Safety Score for this trip. Higher is safer.
      </p>
    </section>
  )
}
