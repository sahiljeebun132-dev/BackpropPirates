import { useEffect, useMemo, useState } from 'react'

import {
  canWorkOnCarHere, GUIDES, POWERTRAIN_LABEL, powertrainWarnings, waitingAdvice, WHERE_PHRASE,
  WHERE_LABEL, type Guide, type Powertrain, type StoppedWhere,
} from '../lib/breakdown'
import { distanceKm } from '../lib/geo'
import { readSavedCar, saveCar, searchCars, useCars } from '../lib/useCars'
import type { AppData, Place } from '../lib/types'
import { GaragesPanel } from './GaragesPanel'

type Props = {
  data: AppData
  /** Where the rider is, if they allowed location. */
  position: { lat: number; lon: number } | null
  onUseGps: () => void
  /** Used as a fallback origin when there is no GPS fix. */
  fallbackPlace: Place
  isDark: boolean
  onBack: () => void
}

type Stage = 'safety' | 'where' | 'car' | 'symptom' | 'guide'

export function BreakdownFlow(props: Props) {
  const { data, position, onUseGps, fallbackPlace, isDark, onBack } = props
  const [stage, setStage] = useState<Stage>('safety')
  const [where, setWhere] = useState<StoppedWhere | null>(null)
  const [powertrain, setPowertrain] = useState<Powertrain>('petrol-diesel')
  const [guide, setGuide] = useState<Guide | null>(null)
  const [injured, setInjured] = useState<boolean | null>(null)
  const [car, setCar] = useState(() => readSavedCar())
  const [carQuery, setCarQuery] = useState('')
  // The list is only wanted once the rider reaches the car question.
  const cars = useCars(stage === 'car')
  const suggestions = useMemo(() => searchCars(cars, carQuery), [cars, carQuery])

  useEffect(() => {
    saveCar(car)
  }, [car])

  const lat = position?.lat ?? fallbackPlace.lat
  const lon = position?.lon ?? fallbackPlace.lon

  const nearest = useMemo(() => {
    const here = { lat, lon }
    const withDistance = data.emergency.places.map((p) => ({ ...p, km: distanceKm(p, here) }))
    const byKind = (kind: string, n: number) =>
      withDistance.filter((p) => p.kind === kind).sort((a, b) => a.km - b.km).slice(0, n)
    return { police: byKind('police', 2), hospital: [...byKind('hospital', 1), ...byKind('clinic', 1)] }
  }, [data, lat, lon])

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-deep"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>

      {/* Emergency numbers stay on screen through the whole flow. */}
      <div className="flex gap-2">
        <a href="tel:114" className="flex-1 rounded-xl bg-flag-red px-3 py-3 text-center text-sm font-bold text-white active:bg-flag-red/90">
          Ambulance 114
        </a>
        <a href="tel:115" className="flex-1 rounded-xl bg-flag-yellow px-3 py-3 text-center text-sm font-bold text-ink active:opacity-90">
          Fire 115
        </a>
        <a href="tel:999" className="flex-1 rounded-xl bg-ink px-3 py-3 text-center text-sm font-bold text-white active:opacity-90">
          Police 999
        </a>
      </div>

      {stage === 'safety' && (
        <Card title="First: is anyone hurt?">
          <p className="text-sm leading-relaxed text-slate-700">
            Before anything about the car. If someone is injured, that is the only thing that
            matters right now.
          </p>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={() => setInjured(true)}
              className="rounded-xl bg-flag-red px-4 py-3.5 text-sm font-semibold text-white active:bg-flag-red/90"
            >
              Yes, someone is hurt
            </button>
            <button
              type="button"
              onClick={() => {
                setInjured(false)
                setStage('where')
              }}
              className="rounded-xl bg-slate-100 px-4 py-3.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 active:bg-slate-200"
            >
              No, everyone is fine
            </button>
          </div>

          {injured === true && (
            <div className="mt-3 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
              <p className="text-sm font-semibold text-red-900">Call 114 now.</p>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-red-900">
                <li>Do not move anyone who is hurt unless the car is on fire or in a traffic lane. Moving someone with a spine or neck injury can do permanent harm.</li>
                <li>Say where you are first, before anything else, in case the call drops.</li>
                <li>Then put the hazard lights on and keep everyone else well clear of traffic.</li>
              </ul>
              <a href="tel:114" className="mt-3 block rounded-lg bg-flag-red px-4 py-3 text-center text-sm font-bold text-white">
                Call 114
              </a>
              <NearestHelp nearest={nearest} />
            </div>
          )}
        </Card>
      )}

      {stage === 'where' && (
        <Card title="Where has the car stopped?">
          <p className="text-sm leading-relaxed text-slate-700">
            This decides whether you should touch the car at all.
          </p>
          <div className="mt-3 grid gap-2">
            {(Object.keys(WHERE_LABEL) as StoppedWhere[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  setWhere(w)
                  setStage('car')
                }}
                className="rounded-xl bg-slate-50 px-4 py-3.5 text-left text-sm font-medium text-slate-800 ring-1 ring-slate-200 active:bg-slate-100"
              >
                {WHERE_LABEL[w]}
              </button>
            ))}
          </div>
        </Card>
      )}

      {where && stage !== 'safety' && stage !== 'where' && (
        <WaitingCard where={where} isDark={isDark} />
      )}

      {stage === 'car' && (
        <Card title="Your car">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">
              Make and model, if you want it remembered
            </span>
            <input
              type="text"
              value={car || carQuery}
              onChange={(e) => {
                setCarQuery(e.target.value)
                setCar('')
              }}
              placeholder="Start typing, for example Vitz"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-3 text-base text-slate-900 ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
            />
          </label>
          {!car && suggestions.length > 0 && (
            <ul className="mt-1.5 overflow-hidden rounded-xl ring-1 ring-slate-200">
              {suggestions.map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    onClick={() => {
                      setCar(c)
                      setCarQuery(c)
                    }}
                    className="w-full bg-white px-3 py-2.5 text-left text-sm text-slate-800 active:bg-slate-100"
                  >
                    {c}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            {cars.length
              ? `${cars.length.toLocaleString()} models from Wikidata. Japanese imports are mostly there, but a few, the Nissan March and Toyota Aqua among them, are not — so this field takes anything you type.`
              : 'Type your car. The suggestion list is still loading, and the field works without it.'}
          </p>

          <h3 className="mt-4 text-sm font-semibold text-slate-900">What does it run on?</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">
            This is the one answer that changes what is safe to do.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(POWERTRAIN_LABEL) as Powertrain[]).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={p === powertrain}
                onClick={() => setPowertrain(p)}
                className={`rounded-xl px-3 py-3 text-sm font-medium ring-1 transition ${
                  p === powertrain
                    ? 'bg-brand-deep text-white ring-brand-deep'
                    : 'bg-slate-50 text-slate-700 ring-slate-200 active:bg-slate-100'
                }`}
              >
                {POWERTRAIN_LABEL[p]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            A hybrid or electric car carries high-voltage cabling, usually orange, which changes
            what you must never touch. We ask rather than guess, because no free database reliably
            says which models are hybrids.
          </p>
          <button
            type="button"
            onClick={() => setStage('symptom')}
            className="mt-3 w-full rounded-xl bg-brand-deep px-4 py-3.5 text-sm font-semibold text-white active:bg-brand-deep/90"
          >
            Continue
          </button>
        </Card>
      )}

      {stage === 'symptom' && (
        <Card title="What is happening?">
          <div className="mt-1 grid gap-2">
            {GUIDES.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  setGuide(g)
                  setStage('guide')
                }}
                className="rounded-xl bg-slate-50 px-4 py-3 text-left ring-1 ring-slate-200 active:bg-slate-100"
              >
                <span className="block text-sm font-semibold text-slate-900">{g.label}</span>
                <span className="block text-xs leading-snug text-slate-600">{g.blurb}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {stage === 'guide' && guide && where && (
        <GuideView
          guide={guide}
          where={where}
          car={car}
          powertrain={powertrain}
          nearest={nearest}
          onChoose={() => setStage('symptom')}
        />
      )}

      {stage !== 'safety' && stage !== 'where' && (
        <>
          <NearestHelpCard
            nearest={nearest}
            position={position}
            onUseGps={onUseGps}
            fallbackName={fallbackPlace.name}
          />
          <GaragesPanel
            lat={lat}
            lon={lon}
            enabled={stage === 'symptom' || stage === 'guide'}
            usingGps={position !== null}
            onUseGps={onUseGps}
          />
        </>
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function WaitingCard({ where, isDark }: { where: StoppedWhere; isDark: boolean }) {
  const lines = waitingAdvice(where, isDark)
  const risky = where === 'motorway' || where === 'main-road'
  return (
    <section className={`rounded-2xl p-4 ring-1 ${risky ? 'bg-amber-50 ring-amber-200' : 'bg-slate-50 ring-slate-200'}`}>
      <h2 className="text-sm font-semibold text-slate-900">
        {risky ? 'Before anything else, get safe' : 'While you are stopped'}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-800">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            {l}
          </li>
        ))}
      </ul>
    </section>
  )
}

function GuideView({
  guide, where, car, powertrain, nearest, onChoose,
}: {
  guide: Guide
  where: StoppedWhere
  car: string
  powertrain: Powertrain
  nearest: { police: NearPlace[]; hospital: NearPlace[] }
  onChoose: () => void
}) {
  const unsafeHere = !canWorkOnCarHere(where)
  const extra = powertrainWarnings(powertrain, guide.id)
  const noSteps = guide.id === 'smoke-or-smell'

  return (
    <>
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{guide.label}</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {car ? `${car} · ${guide.blurb}` : guide.blurb}
            </p>
          </div>
          <button type="button" onClick={onChoose} className="shrink-0 text-xs font-semibold text-brand-deep underline">
            Change
          </button>
        </div>
      </section>

      {(unsafeHere || noSteps) && (
        <section className="rounded-2xl bg-flag-red p-4 text-white shadow-sm">
          <h2 className="text-sm font-bold">
            {noSteps ? 'Do not try to fix this' : 'Not here. This is the wrong place to work on the car'}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-white/90">
            {noSteps
              ? 'Get everyone out and well away from the car, then call.'
              : `You said you are ${WHERE_PHRASE[where]}. Passing traffic is the danger here, not the fault. Call for recovery and wait somewhere safe.`}
          </p>
          <div className="mt-3 flex gap-2">
            <a href="tel:999" className="flex-1 rounded-lg bg-white/15 px-3 py-2.5 text-center text-sm font-semibold text-white ring-1 ring-white/30">
              Police 999
            </a>
            {nearest.police[0]?.phone && (
              <a href={`tel:${nearest.police[0].phone}`} className="flex-1 rounded-lg bg-white/15 px-3 py-2.5 text-center text-sm font-semibold text-white ring-1 ring-white/30">
                {nearest.police[0].town}
              </a>
            )}
          </div>
        </section>
      )}

      {guide.stopAndCall.length > 0 && (
        <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <h2 className="text-sm font-semibold text-amber-900">Stop and call for help if</h2>
          <ul className="mt-2 space-y-1.5">
            {guide.stopAndCall.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-amber-950">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {extra.length > 0 && (
        <section className="rounded-2xl bg-ink p-4 text-white shadow-sm">
          <h2 className="text-sm font-semibold text-brand">
            Because you said {POWERTRAIN_LABEL[powertrain].toLowerCase()}
          </h2>
          <ul className="mt-2 space-y-2">
            {extra.map((e, i) => (
              <li key={i} className="text-sm leading-relaxed text-slate-200">{e}</li>
            ))}
          </ul>
        </section>
      )}

      {!noSteps && !unsafeHere && (
        <>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Before you start</h2>
            <ul className="mt-2 space-y-1.5">
              {guide.before.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  {b}
                </li>
              ))}
            </ul>
            {guide.youNeed && (
              <>
                <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  You need
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {guide.youNeed.map((n, i) => (
                    <li key={i} className="text-sm text-slate-700">· {n}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Step by step</h2>
            <ol className="mt-3 space-y-3">
              {guide.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-deep text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-slate-800">{s.text}</p>
                    {s.caution && (
                      <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
                        {s.caution}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {guide.manualSays && (
        <section className="rounded-2xl bg-slate-100 p-4 ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Only your manual can tell you</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">{guide.manualSays}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            We deliberately do not give model-specific figures. Procedures genuinely differ between
            cars, no free database publishes them, and a confident wrong answer here could get
            somebody hurt.
          </p>
        </section>
      )}
    </>
  )
}

type NearPlace = AppData['emergency']['places'][number] & { km: number }

function NearestHelp({ nearest }: { nearest: { police: NearPlace[]; hospital: NearPlace[] } }) {
  const all = [...nearest.hospital, ...nearest.police].filter((p) => p.phone)
  if (!all.length) return null
  return (
    <ul className="mt-3 space-y-1.5">
      {all.slice(0, 3).map((p) => (
        <li key={p.id}>
          <a href={`tel:${p.phone}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-red-200">
            <span className="min-w-0 truncate text-sm font-medium text-slate-900">{p.name}</span>
            <span className="shrink-0 text-xs font-semibold text-brand-deep">{p.km.toFixed(1)} km · Call</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function NearestHelpCard({
  nearest, position, onUseGps, fallbackName,
}: {
  nearest: { police: NearPlace[]; hospital: NearPlace[] }
  position: { lat: number; lon: number } | null
  onUseGps: () => void
  fallbackName: string
}) {
  const all = [...nearest.hospital, ...nearest.police].filter((p) => p.phone)
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">Nearest help</h2>
      <p className="mt-1 text-xs text-slate-500">
        {position ? (
          'Measured from where you are now.'
        ) : (
          <>
            Measured from {fallbackName}, because location is off.{' '}
            <button type="button" onClick={onUseGps} className="font-semibold text-brand-deep underline">
              Use my location
            </button>
          </>
        )}
      </p>
      <ul className="mt-3 space-y-2">
        {all.slice(0, 4).map((p) => (
          <li key={p.id}>
            <a href={`tel:${p.phone}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                <span className="block text-xs text-slate-500">
                  {p.kind === 'police' ? 'Police station' : p.kind === 'hospital' ? 'Hospital' : p.category} · {p.km.toFixed(1)} km
                </span>
              </span>
              <span className="shrink-0 rounded-lg bg-brand-deep px-3 py-2 text-xs font-semibold text-white">Call</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">
        Straight-line distance. Hospitals, health centres and police stations from Open Data
        Mauritius.
      </p>
    </section>
  )
}
