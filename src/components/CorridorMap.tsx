import { useEffect, useMemo, useState } from 'react'

import { loadRoads, loadedRoads, type Roads } from '../lib/roads'
import { routeBetween } from '../lib/route'
import type { AppData, Hotspot, Place } from '../lib/types'

type OnCorridor = Hotspot & { detourKm: number }

/**
 * The corridor, drawn.
 *
 * The strongest claim this app makes is that it names the black spots on
 * *your* route rather than quoting a district average — and until now that
 * claim arrived as a list of road numbers. A rider who has never heard of
 * B37 learns nothing from "B37". Seeing it sitting across the line they are
 * about to ride is immediate in a way the list is not.
 *
 * Everything here is drawn from files the app already ships: the real
 * geometry of all 48 designated accident-prone segments, the town
 * coordinates derived from official health facilities, and the hospitals
 * and police stations. There are no map tiles and no requests, which is the
 * only reason this survived the Offline Mode card — a tiled map would have
 * been the one feature that went blank in airplane mode, on the slide where
 * we claim it does not.
 *
 * It is not a street map and does not pretend to be. There is no coastline,
 * because we have no coastline data we could cite, and inventing one to
 * make the picture prettier would be the same sin as inventing a figure.
 * What is on screen is exactly what is in the tables.
 */

/** Longitude is compressed at this latitude; without the correction
 *  Mauritius comes out noticeably too wide. */
const LON_SCALE = Math.cos((-20.3 * Math.PI) / 180)

const VIEW_W = 1000

type Bounds = { minLat: number; maxLat: number; minLon: number; maxLon: number }

/** The frame is shaped to the route rather than the other way round.
 *
 *  A fixed 4:3 box wastes most of itself on a diagonal trip — Grand Baie to
 *  Port Louis runs corner to corner and left two thirds of the picture
 *  empty. Deriving the height from the bounds means the corridor fills the
 *  frame whichever way it runs, and the scale stays equal on both axes so
 *  the segments still lie at the angles they really do. */
function viewHeight(bounds: Bounds): number {
  const w = (bounds.maxLon - bounds.minLon) * LON_SCALE
  const h = bounds.maxLat - bounds.minLat
  return Math.round(Math.min(1180, Math.max(620, (VIEW_W * h) / w)))
}

function project(bounds: Bounds, viewH: number) {
  const w = (bounds.maxLon - bounds.minLon) * LON_SCALE
  const h = bounds.maxLat - bounds.minLat
  const scale = Math.min(VIEW_W / w, viewH / h)
  const offX = (VIEW_W - w * scale) / 2
  const offY = (viewH - h * scale) / 2
  return (lat: number, lon: number): [number, number] => [
    offX + (lon - bounds.minLon) * LON_SCALE * scale,
    // Latitude increases northwards and SVG y increases downwards.
    offY + (bounds.maxLat - lat) * scale,
  ]
}

function boundsFor(points: [number, number][]): Bounds {
  const lats = points.map((p) => p[0])
  const lons = points.map((p) => p[1])
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)
  let minLon = Math.min(...lons)
  let maxLon = Math.max(...lons)

  // Pad, and never show a span so small that a short trip fills the frame
  // with two dots and no context.
  const MIN_SPAN = 0.085
  const padLat = Math.max((maxLat - minLat) * 0.22, (MIN_SPAN - (maxLat - minLat)) / 2, 0.012)
  const padLon = Math.max((maxLon - minLon) * 0.22, (MIN_SPAN - (maxLon - minLon)) / 2, 0.012)
  minLat -= padLat
  maxLat += padLat
  minLon -= padLon
  maxLon += padLon
  return { minLat, maxLat, minLon, maxLon }
}

/**
 * The route, when the road network can supply one.
 *
 * Drawn as the real path along the roads rather than a line between two
 * dots. On an island with one motorway and a mountain in the middle, a
 * straight line from Bon Accueil to Rose Belle crosses country nobody
 * drives through — it is 26 km on the map and 41 km on the road.
 *
 * The line is kept as the fallback, because the score is still computed
 * from a corridor around it and a map that disagreed with the number
 * underneath it would be worse than a plain line. The route is the shape of
 * the journey; the corridor is what was measured.
 */
export function CorridorMap({
  data,
  origin,
  destination,
  hotspots,
  emergency,
}: {
  data: AppData
  origin: Place
  destination: Place
  hotspots: OnCorridor[]
  emergency: { hospitals: { lat: number; lon: number; name: string }[]; police: { lat: number; lon: number; name: string }[] }
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [roads, setRoads] = useState<Roads | null>(() => loadedRoads())

  // Fetched once and cached; the map draws the straight line until it lands
  // rather than waiting on it.
  useEffect(() => {
    void loadRoads().then(setRoads)
  }, [])

  const route = useMemo(
    () => routeBetween(roads, origin, destination),
    [roads, origin, destination],
  )

  const all = data.hotspots.hotspots
  const onCorridor = useMemo(() => new Set(hotspots.map((h) => h.id)), [hotspots])

  const { to, ways, nearby, viewH } = useMemo(() => {
    // Frame on the trip and the black spots that sit on it.
    const seed: [number, number][] = [
      [origin.lat, origin.lon],
      [destination.lat, destination.lon],
      ...hotspots.flatMap((h) => h.points as [number, number][]),
    ]
    const b = boundsFor(seed)
    const vh = viewHeight(b)
    const inView = (lat: number, lon: number) =>
      lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon
    // The classified network inside the frame. Without it this was a route
    // and some red marks floating on white — technically a map and not
    // recognisably one. Minor roads are dropped on a wide frame, because a
    // tertiary road across a whole district is a hairline that reads as
    // smudge rather than as information.
    const spanKm = (b.maxLat - b.minLat) * 110.574
    const floor = spanKm > 28 ? 2 : spanKm > 14 ? 1 : 0
    const ways = (roads?.ways ?? []).filter(
      (w) => w.c >= floor && w.p.some((pt) => inView(pt[0], pt[1])),
    )

    return {
      viewH: vh,
      to: project(b, vh),
      ways,
      nearby: {
        // Off-corridor segments inside the frame, drawn faintly so the
        // highlighted ones read as a selection rather than as everything.
        others: all.filter((h) => !onCorridor.has(h.id) && inView(h.mid[0], h.mid[1])),
        towns: data.places.places.filter((p) => inView(p.lat, p.lon)),
      },
    }
  }, [all, data.places.places, destination, hotspots, onCorridor, origin, roads])

  const path = (points: [number, number][]) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${to(p[0], p[1]).map((n) => n.toFixed(1)).join(' ')}`).join(' ')

  const [ox, oy] = to(origin.lat, origin.lon)
  const [dx, dy] = to(destination.lat, destination.lon)
  const chosen = picked ? hotspots.find((h) => h.id === picked) : null

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Your corridor</h2>
        <span className="text-[11px] text-slate-500">
          {hotspots.length} accident-prone {hotspots.length === 1 ? 'stretch' : 'stretches'}
        </span>
      </div>

      {/* A light canvas, inverted from the near-black it used to be. The red
          stretches were legible on black because everything else receded;
          on #F8FAFC the same reds still carry, but the context layers had to
          come down in weight rather than up, or the map turns into noise. */}
      <div className="mt-3 overflow-hidden rounded-xl bg-[#F8FAFC] ring-1 ring-edge">
        <svg
          viewBox={`0 0 ${VIEW_W} ${viewH}`}
          className="block w-full"
          role="img"
          aria-label={`Map of the corridor from ${origin.name} to ${destination.name}, showing ${hotspots.length} designated accident-prone road segments. The same segments are listed in full below.`}
        >
          {/* Other designated segments in the area, for context. */}
          {nearby.others.map((h) => (
            <path
              key={h.id}
              d={path(h.points as [number, number][])}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={5}
              strokeLinecap="round"
              opacity={0.55}
            />
          ))}

          {/* Towns in the frame. */}
          {nearby.towns.map((p) => {
            const [x, y] = to(p.lat, p.lon)
            const end = p.id === origin.id || p.id === destination.id
            if (end) return null
            return <circle key={p.id} cx={x} cy={y} r={4.5} fill="#94a3b8" />
          })}

          {/* The road network, behind everything. Pale and thin: it is
              context for the red stretches, not the subject. */}
          {ways.map((w, i) => (
            <path
              key={`rd${i}`}
              d={path(w.p)}
              fill="none"
              stroke={w.c >= 3 ? '#9fb0c4' : w.c === 2 ? '#b8c5d4' : '#ccd6e0'}
              strokeWidth={w.c >= 4 ? 3.6 : w.c === 3 ? 2.8 : w.c === 2 ? 2 : 1.3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* The trip. The road where the network can supply one, and the
              straight line where it cannot — dashed in that case, because a
              dashed line reads as an approximation and a solid one does not.

              The score is still measured in a corridor around the direct
              line, so when a route is drawn the line stays underneath it,
              faintly. A map that quietly disagreed with the number printed
              beside it would be the worst kind of wrong. */}
          {route ? (
            <>
              <line
                x1={ox} y1={oy} x2={dx} y2={dy}
                stroke="#0e6fa3" strokeWidth={3} strokeDasharray="8 10" opacity={0.28}
              />
              <path
                d={route.points
                  .map((pt: [number, number], i: number) => `${i ? 'L' : 'M'}${to(pt[0], pt[1]).map((n) => n.toFixed(1)).join(' ')}`)
                  .join(' ')}
                fill="none"
                stroke="#0e6fa3"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.92}
              />
            </>
          ) : (
            <line
              x1={ox} y1={oy} x2={dx} y2={dy}
              stroke="#0e6fa3" strokeWidth={6} strokeDasharray="14 11" opacity={0.85}
            />
          )}

          {/* Hospitals and police stations near the route. */}
          {emergency.hospitals.slice(0, 4).map((p) => {
            const [x, y] = to(p.lat, p.lon)
            return (
              <g key={`h${p.name}`} opacity={0.9}>
                <circle cx={x} cy={y} r={7} fill="#ffffff" stroke="#007848" strokeWidth={2} />
                <path d={`M${x - 3.4} ${y}H${x + 3.4}M${x} ${y - 3.4}V${y + 3.4}`}
                      stroke="#007848" strokeWidth={2} strokeLinecap="round" />
              </g>
            )
          })}
          {emergency.police.slice(0, 4).map((p) => {
            const [x, y] = to(p.lat, p.lon)
            return <circle key={`p${p.name}`} cx={x} cy={y} r={5} fill="#ffffff"
                           stroke="#b45309" strokeWidth={2.4} opacity={0.95} />
          })}

          {/* The black spots on this corridor, over everything else. */}
          {hotspots.map((h) => {
            const on = picked === h.id
            return (
              <path
                key={h.id}
                d={path(h.points as [number, number][])}
                fill="none"
                stroke={on ? '#fca5a5' : '#d83030'}
                strokeWidth={on ? 14 : 10}
                strokeLinecap="round"
                className="cursor-pointer"
                onClick={() => setPicked(on ? null : h.id)}
              >
                <title>{h.name}</title>
              </path>
            )
          })}

          {/* Endpoints last, so nothing is drawn over them. */}
          <circle cx={ox} cy={oy} r={13} fill="#0e6fa3" stroke="#ffffff" strokeWidth={4} />
          <circle cx={dx} cy={dy} r={13} fill="#ffffff" stroke="#0e6fa3" strokeWidth={5} />
        </svg>
      </div>

      {chosen ? (
        <p className="mt-2 rounded-xl bg-flag-red/10 p-2.5 text-xs leading-relaxed text-slate-800 ring-1 ring-flag-red/25">
          {chosen.road && <span className="font-semibold">{chosen.road} · </span>}
          {chosen.label} · {chosen.lengthKm.toFixed(1)} km. Officially designated
          accident-prone.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          {hotspots.length > 0
            ? 'Tap a red stretch to see which road it is. '
            : 'Nothing designated lies on this corridor, which is good news and is why nothing is marked red. '}
          Blue is the road route, worked out on the phone from the network the app carries.
          The faint dashed line is the straight one between the two towns: the score is still
          measured in a corridor around that, so it stays visible rather than being quietly
          replaced.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {hotspots.length > 0 && (
          <span><span className="mr-1 inline-block h-2 w-4 rounded-sm bg-flag-red align-middle" />On your route</span>
        )}
        <span><span className="mr-1 inline-block h-2 w-4 rounded-sm bg-slate-500 align-middle" />Other designated stretches</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-flag-green align-middle" />Hospital</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-flag-yellow align-middle" />Police</span>
      </div>
    </section>
  )
}
