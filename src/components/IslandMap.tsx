import { useEffect, useMemo, useState } from 'react'

import { loadRoads, loadedRoads, type Roads } from '../lib/roads'
import type { AppData } from '../lib/types'

/**
 * Every designated accident-prone stretch on the island, on the roads.
 *
 * The accidents screen listed forty-eight stretches by name, which answers
 * "which ones" and not "where". A rider in the north does not know whether
 * B28 Caroline is anywhere near them, and a list cannot tell them.
 *
 * The day and night views are the same geometry with a different palette,
 * and the switch is not decoration. Darkness with no street lighting is the
 * single largest multiplier in the whole dataset: 8.2% of casualties on an
 * unlit road at night are fatal, against 3.7% in daylight. Showing the same
 * map twice, once dark, is the plainest way to say that the road does not
 * change but the consequences do.
 *
 * No tiles, like everywhere else: this is the network the app carries.
 */
/** Towns far enough apart to label at island scale without colliding. */
const LABELLED = new Set([
  'grand-baie', 'goodlands', 'centre-de-flacq', 'port-louis', 'curepipe',
  'mahebourg', 'tamarin', 'chemin-grenier', 'souillac', 'triolet',
])

export function IslandMap({ data }: { data: AppData }) {
  const [roads, setRoads] = useState<Roads | null>(() => loadedRoads())
  const [night, setNight] = useState(false)

  useEffect(() => {
    void loadRoads().then(setRoads)
  }, [])

  // Mauritius, with a little air around it.
  const B = { minLat: -20.54, maxLat: -19.97, minLon: 57.3, maxLon: 57.82 }
  const W = 360
  const KM_LAT = 110.574
  const KM_LON = 104.4
  const H = Math.round(
    (W * ((B.maxLat - B.minLat) * KM_LAT)) / ((B.maxLon - B.minLon) * KM_LON),
  )

  const to = (lat: number, lon: number): [number, number] => [
    ((lon - B.minLon) / (B.maxLon - B.minLon)) * W,
    ((B.maxLat - lat) / (B.maxLat - B.minLat)) * H,
  ]

  const path = (pts: [number, number][]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${to(p[0], p[1]).map((n) => n.toFixed(1)).join(' ')}`).join(' ')

  // Every class, drawn in two passes, because the island has no coastline
  // anywhere in the data. Its shape can only come from the road network, and
  // keeping just the trunk roads threw away 2,721 of 4,408 ways -- which left
  // not a map but a handful of lines floating in a rectangle. The minor roads
  // ARE the land: at island scale they read as texture, and the coast appears
  // where they stop. Pale and hair-thin underneath, the big roads over them,
  // so the hierarchy a rider needs still reads at a glance.
  const minor = useMemo(() => (roads?.ways ?? []).filter((w) => w.c < 2), [roads])
  const ways = useMemo(() => (roads?.ways ?? []).filter((w) => w.c >= 2), [roads])

  const ink = night
    ? { bg: '#0B1018', road: '#273448', minor: '#18212E', spot: '#FF5A5F', town: '#6E819A', edge: '#1C2636' }
    : { bg: '#F4F7FA', road: '#9FB0C4', minor: '#C8D4E0', spot: '#D7263D', town: '#7C8EA6', edge: '#DCE3EB' }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Where they are</h2>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {data.hotspots.hotspots.length} stretches
        </span>
      </div>

      <div className="mt-1 flex gap-2">
        <button
          type="button"
          aria-pressed={!night}
          onClick={() => setNight(false)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-bold ${
            !night ? 'bg-brand-deep text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          Daylight
        </button>
        <button
          type="button"
          aria-pressed={night}
          onClick={() => setNight(true)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-bold ${
            night ? 'bg-ink text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          After dark, unlit
        </button>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 block w-full rounded-xl"
        style={{ background: ink.bg }}
        role="img"
        aria-label={`Mauritius with all ${data.hotspots.hotspots.length} designated accident-prone stretches`}
      >
        {minor.map((w, i) => (
          <path
            key={`m${i}`}
            d={path(w.p as [number, number][])}
            fill="none"
            stroke={ink.minor}
            strokeWidth={0.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {ways.map((w, i) => (
          <path
            key={`r${i}`}
            d={path(w.p as [number, number][])}
            fill="none"
            stroke={ink.road}
            strokeWidth={w.c >= 4 ? 2.2 : w.c === 3 ? 1.6 : 1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {data.hotspots.hotspots.map((h) => (
          <path
            key={h.id}
            d={path(h.points as [number, number][])}
            fill="none"
            stroke={ink.spot}
            strokeWidth={night ? 3.4 : 3}
            strokeOpacity={night ? 1 : 0.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Hand-picked and spread out rather than the first fourteen
            alphabetically, which stacked Beau Bassin on Moka and Flic en
            Flac on Black River in the one part of the island where the
            stretches are densest. */}
        {data.places.places
          .filter((p) => LABELLED.has(p.id))
          .map((p) => {
          const [x, y] = to(p.lat, p.lon)
          return (
            <text
              key={p.id}
              x={x}
              y={y}
              fill={ink.town}
              fontSize="7.5"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {p.name}
            </text>
          )
        })}

        <rect
          x="0.5" y="0.5" width={W - 1} height={H - 1} rx="12"
          fill="none" stroke={ink.edge} strokeWidth="1"
        />
      </svg>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {night
          ? 'Same roads, same stretches. After dark with no street lighting, 8.2% of casualties are fatal — against 3.7% in daylight. The road does not change; what it costs does.'
          : 'All 48 stretches the authorities have designated accident-prone, drawn on the road network the app carries. Tap “After dark” to see what the same trip is worth at night.'}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">
        Accident Prone Areas and Light conditions 2018, Open Data Mauritius.
      </p>
    </section>
  )
}
