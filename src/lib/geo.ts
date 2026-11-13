/** Distance maths for an island 65 km across.
 *
 * Mauritius spans roughly 19.98 S to 20.53 S. Over that range an equirectangular
 * approximation is within about 0.1% of the great-circle distance, and it is
 * cheap enough to test every hotspot vertex against a corridor on each render.
 */

export const KM_PER_DEG_LAT = 110.57
export const KM_PER_DEG_LON = 111.32 * Math.cos((20.3 * Math.PI) / 180)

export type Point = { lat: number; lon: number }

export function distanceKm(a: Point, b: Point): number {
  const dy = (a.lat - b.lat) * KM_PER_DEG_LAT
  const dx = (a.lon - b.lon) * KM_PER_DEG_LON
  return Math.hypot(dx, dy)
}

/** Shortest distance from p to the segment a-b, in km. */
export function distanceToSegmentKm(p: Point, a: Point, b: Point): number {
  const py = (p.lat - a.lat) * KM_PER_DEG_LAT
  const px = (p.lon - a.lon) * KM_PER_DEG_LON
  const by = (b.lat - a.lat) * KM_PER_DEG_LAT
  const bx = (b.lon - a.lon) * KM_PER_DEG_LON
  const denom = bx * bx + by * by
  if (denom === 0) return Math.hypot(px, py)
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / denom))
  return Math.hypot(px - t * bx, py - t * by)
}

/** Closest approach of a polyline to the corridor a-b, in km. */
export function polylineDistanceToCorridorKm(
  points: [number, number][],
  a: Point,
  b: Point,
): number {
  let best = Infinity
  for (const [lat, lon] of points) {
    const d = distanceToSegmentKm({ lat, lon }, a, b)
    if (d < best) best = d
  }
  return best
}

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
