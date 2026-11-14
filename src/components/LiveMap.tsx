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

const VIEW = 320
const CENTRE = VIEW / 2

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
}) {
  const { to, ways, segments, towns, places } = useMemo(() => {
    // Half the viewport covers radiusKm, so the full frame is a diameter.
    const scale = CENTRE / radiusKm
    const to = (lat: number, lon: number): [number, number] => [
      CENTRE + (lon - position.lon) * KM_PER_DEG_LON * scale,
      CENTRE - (lat - position.lat) * KM_PER_DEG_LAT * scale,
    ]

    // A generous box, so a segment that crosses the frame is drawn even when
    // its midpoint is outside it.
    const span = radiusKm * 1.6
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

  // One ring per kilometre, so distance is readable without a scale bar.
  const rings = Array.from({ length: Math.floor(radiusKm) }, (_, i) => i + 1)

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className="block aspect-square w-full rounded-[20px] bg-[#0E1420]"
      role="img"
      aria-label={`Map of the road within ${radiusKm} km, centred on you`}
    >
      <defs>
        <radialGradient id="zw-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1C7FE8" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#1C7FE8" stopOpacity="0" />
        </radialGradient>
        <clipPath id="zw-clip">
          <circle cx={CENTRE} cy={CENTRE} r={CENTRE - 2} />
        </clipPath>
      </defs>

      <g clipPath="url(#zw-clip)">
        <circle cx={CENTRE} cy={CENTRE} r={CENTRE} fill="#0E1420" />

        {/* Distance rings, faint, labelled only at the outermost. */}
        {rings.map((km) => (
          <circle
            key={km}
            cx={CENTRE}
            cy={CENTRE}
            r={(CENTRE / radiusKm) * km}
            fill="none"
            stroke="#1E2A3C"
            strokeWidth="1"
          />
        ))}

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
              fill="#5A6C84"
              fontSize="7"
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
        <circle cx={CENTRE} cy={CENTRE} r="22" fill="url(#zw-glow)" />
        {heading !== null && (
          <path
            d={`M${CENTRE} ${CENTRE - 15} L${CENTRE - 6} ${CENTRE + 5} L${CENTRE} ${CENTRE + 1} L${CENTRE + 6} ${CENTRE + 5} Z`}
            fill="#FFFFFF"
            transform={`rotate(${heading} ${CENTRE} ${CENTRE})`}
          />
        )}
        {heading === null && <circle cx={CENTRE} cy={CENTRE} r="5" fill="#FFFFFF" />}
        <circle cx={CENTRE} cy={CENTRE} r="5.5" fill="none" stroke="#1C7FE8" strokeWidth="2" />
      </g>

      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={CENTRE - 2}
        fill="none"
        stroke="#1E2A3C"
        strokeWidth="2"
      />
      <text x={CENTRE} y={14} fill="#5A6C84" fontSize="9" textAnchor="middle">
        {radiusKm} km
      </text>
    </svg>
  )
}
