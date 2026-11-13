import type { DepartureAdvice } from '../lib/departure'
import { estimateTripMinutes, AVERAGE_SPEED_KMH } from '../lib/departure'
import { HEAVY_RAIN_MM, RAIN_MM_THRESHOLD, rainOverTrip, type LiveConditions as Live } from '../lib/live'
import { TIME_BAND_LABEL } from '../lib/risk'
import type { AppData, TimeBand } from '../lib/types'

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

type Props = {
  data: AppData
  live: Live
  advice: DepartureAdvice
  departAt: Date
  directKm: number
  onAccept: (at: Date) => void
}

/** What the sky is doing on this corridor, and whether waiting would help.
 *  Sunrise and sunset drive the score; rain is advice only, because the
 *  official figures put it at 1.26 times the fatal share and no more. */
export function LiveConditionsPanel({ data, live, advice, departAt, directKm, onAccept }: Props) {
  const tripMinutes = estimateTripMinutes(directKm)
  const rain = rainOverTrip(live, departAt, tripMinutes)
  const wet = data.conditions.weather.conditions.find((c) => c.condition === 'Rainy')
  const fine = data.conditions.weather.conditions.find((c) => c.condition === 'Fine')
  const day = advice.current.band === 'day'
  const sunKey = `${departAt.getFullYear()}-${String(departAt.getMonth() + 1).padStart(2, '0')}-${String(departAt.getDate()).padStart(2, '0')}`
  const sun = live.sun[sunKey]

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Conditions when you leave</h2>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-flag-green opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-flag-green" />
          </span>
          Live
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Tile
          label="Leaving"
          value={timeFmt.format(departAt)}
          note={`about ${tripMinutes} min`}
        />
        <Tile
          label="Light"
          value={day ? 'Daylight' : advice.current.band === 'dawn-dusk' ? 'Dusk' : 'Dark'}
          note={sun ? `sunset ${timeFmt.format(sun.sunset)}` : ''}
        />
        <Tile
          label="Rain"
          value={rain.totalMm < 0.1 ? 'Dry' : `${rain.totalMm.toFixed(1)} mm`}
          note={rain.peakMm >= HEAVY_RAIN_MM ? 'heavy' : rain.totalMm >= RAIN_MM_THRESHOLD ? 'wet road' : 'over the trip'}
        />
      </div>

      {advice.better && (
        <div className="mt-3 rounded-xl bg-flag-green/10 p-3 ring-1 ring-flag-green/30">
          <p className="text-sm font-semibold text-slate-900">
            {advice.better.minutesAway < 0 ? 'Leaving earlier, at' : 'Leaving at'}{' '}
            {timeFmt.format(advice.better.at)} scores {advice.better.score}, not{' '}
            {advice.current.score}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">
            {explainShift(data, advice.current.band, advice.better.band)}
          </p>
          <button
            type="button"
            onClick={() => onAccept(advice.better!.at)}
            className="mt-2 rounded-lg bg-flag-green px-3 py-2 text-xs font-semibold text-white active:bg-flag-green/90"
          >
            Use {timeFmt.format(advice.better.at)} instead
          </button>
        </div>
      )}

      {rain.totalMm >= RAIN_MM_THRESHOLD && wet && fine && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Wet road.</span>{' '}
          {rain.peakMm >= HEAVY_RAIN_MM
            ? `Up to ${rain.peakMm.toFixed(0)} mm in an hour, enough to put standing water on low-lying roads. `
            : ''}
          In the rain {(wet.fatalShare * 100).toFixed(1)}% of casualty accidents are fatal, against{' '}
          {(fine.fatalShare * 100).toFixed(1)}% in fine weather — about {wet.fatalRatioVsFine} times.
          Real, but small enough that we leave it out of the score and tell you instead.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Sunrise, sunset and rain: Open-Meteo forecast for this corridor, refreshed on load.
        Fatality shares by weather: Open Data Mauritius, {data.conditions.weather.years.join('–')}{' '}
        pooled. Trip length assumes about {AVERAGE_SPEED_KMH} km/h door to door, which is our
        estimate, not a published figure.
      </p>
    </section>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2.5 ring-1 ring-slate-200">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
      {note && <p className="mt-0.5 text-[10px] leading-tight text-slate-500">{note}</p>}
    </div>
  )
}

/** The official light category behind each band the app can land in. */
const BAND_CONDITION: Record<string, string> = {
  day: 'Day light',
  'dawn-dusk': 'Dawn dusk',
  'night-lit': 'Darkness street lights present and lit',
  'night-unlit': 'Darkness no street lighting',
}
const BAND_WORDS: Record<string, string> = {
  day: 'daylight',
  'dawn-dusk': 'dusk',
  'night-lit': 'darkness on a lit road',
  'night-unlit': 'darkness with no street lighting',
}

/** Says what actually changes between two departure times, with the real
 *  fatality shares rather than a vague "conditions are better". */
function explainShift(data: AppData, from: string, to: string): string {
  const find = (b: string) =>
    data.conditions.light.conditions.find((c) => c.condition === BAND_CONDITION[b])
  const a = find(from)
  const b = find(to)
  if (!a || !b || from === to) return 'Conditions on this corridor are better in that window.'
  const pc = (n: number) => `${(n * 100).toFixed(1)}%`
  const lead =
    to === 'day' ? 'That puts the trip in daylight. ' : `That moves the trip into ${BAND_WORDS[to]}. `
  return (
    `${lead}Across Mauritius ${pc(b.fatalShare)} of casualties in ${BAND_WORDS[to]} are fatal, ` +
    `against ${pc(a.fatalShare)} in ${BAND_WORDS[from]}.`
  )
}

/** Shown when the forecast cannot be reached, so the rider knows the score is
 *  running on what they set by hand rather than on live conditions. */
export function LiveUnavailable({ band, onChange }: { band: TimeBand; onChange: () => void }) {
  return (
    <section className="rounded-2xl bg-slate-100 p-4 ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">No live forecast right now</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        The score is using <span className="font-medium">{TIME_BAND_LABEL[band].toLowerCase()}</span>,
        as you set it, instead of working the light out from today&rsquo;s sunset. Every other
        figure on this page comes from data already loaded, so the rest still holds.
      </p>
      <button
        type="button"
        onClick={onChange}
        className="mt-2 text-xs font-semibold text-brand-deep underline"
      >
        Change the light setting
      </button>
    </section>
  )
}
