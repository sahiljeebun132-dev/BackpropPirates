import { useMemo } from 'react'

import type { AppData } from '../lib/types'
import type { Rider } from '../lib/presence'
import type { Roads } from '../lib/roads'

/**
 * The road around you, as you move through it.
 *
 * There are no map tiles here and that is the whole design. A tiled map is a
 * request per square per zoom, and the one claim this app makes that nobody
 * else at the table can make is that it works with no signal at all — the
 * score, the black spots, the guides, the emergency numbers. A map that went
 * blank in airplane mode would take the claim with it.
 *
 * So the road is drawn from the geometry the app already carries: 48
 * officially designated accident-prone segments, every town, 241 hospitals
 * and police stations. That ships inside the APK and costs nothing to draw.
 * It is not a street map and it does not pretend to be one — it is the
 * hazard layer, which is the only layer this app has any business claiming
 * authority over.
 *
 * What moves is the frame. The rider sits at the centre and the world slides
 * under them, which is the one thing a map in motion has to do.
 */

/**
 * A tall rectangle, because that is the shape of a phone held up on a bike.
 *
 * This was a circle at first, clipped to a disc with range rings — handsome,
 * and wrong. A disc throws away the top and bottom of the screen, which is
 * exactly where the road you are about to be on is, and it reads as a radar
 * rather than as a map. The rings are gone with it: a scale bar says the
 * same thing in a corner instead of drawing five circles through the middle
 * of everything.
 */
const VIEW_W = 360
const VIEW_H = 520
const CX = VIEW_W / 2
/** Not the middle. The rider sits low, so most of the frame is the road
 *  ahead rather than the road already ridden. */
const CY = VIEW_H * 0.62

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LON = 104.4

export type Hazard = { kind: string; lat: number; lon: number }

export function LiveMap({
  data,
  position,
  heading,
  riders,
  hazards,
  radiusKm,
  roads,
  route,
  passed,
}: {
  data: AppData
  position: { lat: number; lon: number }
  /** Degrees clockwise from north, or null when standing still. */
  heading: number | null
  riders: Rider[]
  hazards: Hazard[]
  radiusKm: number
  /** The classified network, or null until it has loaded. */
  roads: Roads | null
  /** The journey being navigated, or null when just riding. */
  route: [number, number][] | null
  /** How far along that route the rider is, so the part already ridden can
   *  be drawn differently from the part still to come. */
  passed: number
}) {
  const { to, ways, segments, towns, places } = useMemo(() => {
    // Half the viewport covers radiusKm, so the full frame is a diameter.
    // Half the width covers radiusKm, so the frame is a diameter across.
    const scale = CX / radiusKm
    const to = (lat: number, lon: number): [number, number] => [
      CX + (lon - position.lon) * KM_PER_DEG_LON * scale,
      CY - (lat - position.lat) * KM_PER_DEG_LAT * scale,
    ]

    // A generous box, so a segment that crosses the frame is drawn even when
    // its midpoint is outside it.
    const span = radiusKm * 2.2
    const dLat = span / KM_PER_DEG_LAT
    const dLon = span / KM_PER_DEG_LON
    const inBox = (lat: number, lon: number) =>
      Math.abs(lat - position.lat) <= dLat && Math.abs(lon - position.lon) <= dLon

    // Minor roads are dropped as the frame widens: at five kilometres a
    // tertiary road is a hairline among hundreds and reads as noise, while
    // at one kilometre it is the street you are actually on.
    const floor = radiusKm >= 4 ? 2 : radiusKm >= 2 ? 1 : 0
    const ways = (roads?.ways ?? []).filter(
      (w) => w.c >= floor && w.p.some((p) => inBox(p[0], p[1])),
    )

    return {
      to,
      ways,
      segments: data.hotspots.hotspots.filter((h) =>
        (h.points as [number, number][]).some((p) => inBox(p[0], p[1])),
      ),
      towns: data.places.places.filter((p) => inBox(p.lat, p.lon)),
      places: [
        ...data.emergency.places
          .filter((p) => inBox(p.lat, p.lon))
          .slice(0, 12),
      ],
    }
  }, [data, position.lat, position.lon, radiusKm, roads])

  const path = (points: [number, number][]) =>
    points
      .map((p, i) => `${i ? 'L' : 'M'}${to(p[0], p[1]).map((n) => n.toFixed(1)).join(' ')}`)
      .join(' ')

  // A scale bar: one kilometre, wherever that lands.
  const kmPx = CX / radiusKm

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="block w-full rounded-[20px] bg-[#0E1420]"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
      role="img"
      aria-label={`Map of the road within ${radiusKm} km, centred on you`}
    >
      <defs>
        <radialGradient id="zw-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1C7FE8" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#1C7FE8" stopOpacity="0" />
        </radialGradient>
        <clipPath id="zw-clip">
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="20" />
        </clipPath>
      </defs>

      <g clipPath="url(#zw-clip)">
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#0E1420" />

        {/* The road network, under everything else. Thicker and paler as
            the class rises, which is most of what makes a tangle of lines
            read as roads rather than as scribble. */}
        {ways.map((w, i) => (
          <path
            key={`w${i}`}
            d={path(w.p)}
            fill="none"
            stroke={w.c >= 3 ? '#44536B' : w.c === 2 ? '#36435A' : '#2A3547'}
            strokeWidth={w.c >= 4 ? 3.4 : w.c === 3 ? 2.6 : w.c === 2 ? 1.9 : 1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* The journey. The road already ridden is dimmed, so the bright
            part of the line is always the part that still matters. */}
        {route && route.length > 1 && (
          <>
            <path
              d={path(route.slice(0, Math.max(2, passed + 1)))}
              fill="none"
              stroke="#2B4463"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={path(route.slice(Math.max(0, passed)))}
              fill="none"
              stroke="#4493F8"
              strokeWidth="6"
              strokeOpacity="0.95"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* The hazard layer: officially designated accident-prone stretches. */}
        {segments.map((h) => (
          <path
            key={h.id}
            d={path(h.points as [number, number][])}
            fill="none"
            stroke="#E5484D"
            strokeWidth="3"
            strokeOpacity="0.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Hospitals and police stations — the things you want when it has
            already gone wrong. */}
        {places.map((p, i) => {
          const [x, y] = to(p.lat, p.lon)
          return <circle key={`e${i}`} cx={x} cy={y} r="2.5" fill="#3FB950" fillOpacity="0.9" />
        })}

        {towns.map((p) => {
          const [x, y] = to(p.lat, p.lon)
          return (
            <text
              key={p.id}
              x={x}
              y={y}
              fill="#7C8EA6"
              fontSize="9"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {p.name}
            </text>
          )
        })}

        {/* Hazards other riders have reported. */}
        {hazards.map((h, i) => {
          const [x, y] = to(h.lat, h.lon)
          return (
            <g key={`h${i}`}>
              <circle cx={x} cy={y} r="7" fill="#D29922" fillOpacity="0.18" />
              <circle cx={x} cy={y} r="3.4" fill="#D29922" />
            </g>
          )
        })}

        {/* Other riders, as plain dots. No ids, no trails, no headings —
            everything that would let one be followed is simply not sent. */}
        {riders.map((r, i) => {
          const [x, y] = to(r[0], r[1])
          return (
            <g key={`r${i}`}>
              <circle cx={x} cy={y} r="6" fill="#4493F8" fillOpacity="0.20" />
              <circle cx={x} cy={y} r="3" fill="#4493F8" />
            </g>
          )
        })}

        {/* You, in the middle, because the frame moves and you do not. */}
        <circle cx={CX} cy={CY} r="26" fill="url(#zw-glow)" />
        {heading !== null && (
          <path
            d={`M${CX} ${CY - 16} L${CX - 7} ${CY + 6} L${CX} ${CY + 1} L${CX + 7} ${CY + 6} Z`}
            fill="#FFFFFF"
            transform={`rotate(${heading} ${CX} ${CY})`}
          />
        )}
        {heading === null && <circle cx={CX} cy={CY} r="6" fill="#FFFFFF" />}
        <circle cx={CX} cy={CY} r="6.5" fill="none" stroke="#1C7FE8" strokeWidth="2.5" />
      </g>

      {/* Scale bar, bottom left, out of the way of everything. */}
      <g opacity="0.75">
        <line
          x1="14" y1={VIEW_H - 16} x2={14 + kmPx} y2={VIEW_H - 16}
          stroke="#8FA3BC" strokeWidth="2.5" strokeLinecap="round"
        />
        <line x1="14" y1={VIEW_H - 20} x2="14" y2={VIEW_H - 12} stroke="#8FA3BC" strokeWidth="2" />
        <line
          x1={14 + kmPx} y1={VIEW_H - 20} x2={14 + kmPx} y2={VIEW_H - 12}
          stroke="#8FA3BC" strokeWidth="2"
        />
        <text x={14 + kmPx / 2} y={VIEW_H - 24} fill="#8FA3BC" fontSize="10" textAnchor="middle">
          1 km
        </text>
      </g>
      <rect
        x="1" y="1" width={VIEW_W - 2} height={VIEW_H - 2} rx="20"
        fill="none" stroke="#1E2A3C" strokeWidth="2"
      />
    </svg>
  )
}
