import type { Roads } from './roads'

/**
 * The road you would actually take, instead of a line between two dots.
 *
 * The map drew origin to destination as a straight line, which on an island
 * with one motorway and a mountain in the middle is not a route — it is a
 * line that happens to touch both ends. Bon Accueil to Rose Belle by that
 * drawing crosses country nobody drives through.
 *
 * Now that the classified network ships with the app there is no reason to
 * fake it. This builds a graph out of those ways and runs A* over it, on the
 * phone, with no request and no routing service. It is not turn-by-turn and
 * does not claim to be: it is the shape of the journey, which is what the
 * map was always trying to show.
 *
 * The one subtlety is connectivity. Simplification keeps the ends of every
 * way but can drop a mid-way point, and OSM junctions are shared nodes that
 * may have been exactly such a point. So node identity is a grid of about
 * twenty metres rather than an exact coordinate: two roads that pass within
 * twenty metres of each other are treated as joined. That is occasionally
 * generous — a bridge over a road is not a junction — but the alternative is
 * a network that silently falls apart into islands, and a route that fails
 * is worse than a route that is twenty metres loose.
 */

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LON = 104.4

/** About twenty metres. Small enough not to weld parallel carriageways
 *  together, large enough to repair a junction lost to simplification. */
const SNAP = 0.0002

type NodeId = number

type Graph = {
  /** Node coordinates, indexed by id. */
  lat: Float64Array
  lon: Float64Array
  /** Flat adjacency: edges[i] is a list of [neighbour, km]. */
  edges: Map<NodeId, [NodeId, number][]>
}

let built: { roads: Roads; graph: Graph } | null = null

const key = (lat: number, lon: number): string =>
  `${Math.round(lat / SNAP)},${Math.round(lon / SNAP)}`

export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return Math.hypot((aLat - bLat) * KM_PER_DEG_LAT, (aLon - bLon) * KM_PER_DEG_LON)
}

function build(roads: Roads): Graph {
  const index = new Map<string, NodeId>()
  const lats: number[] = []
  const lons: number[] = []
  const edges = new Map<NodeId, [NodeId, number][]>()

  const node = (lat: number, lon: number): NodeId => {
    const k = key(lat, lon)
    const found = index.get(k)
    if (found !== undefined) return found
    const id = lats.length
    index.set(k, id)
    lats.push(lat)
    lons.push(lon)
    edges.set(id, [])
    return id
  }

  const link = (a: NodeId, b: NodeId, d: number) => {
    if (a === b) return
    edges.get(a)!.push([b, d])
    edges.get(b)!.push([a, d])
  }

  for (const way of roads.ways) {
    let prev: NodeId | null = null
    let prevLat = 0
    let prevLon = 0
    for (const [lat, lon] of way.p) {
      const id = node(lat, lon)
      if (prev !== null) link(prev, id, km(prevLat, prevLon, lat, lon))
      prev = id
      prevLat = lat
      prevLon = lon
    }
  }

  return { lat: Float64Array.from(lats), lon: Float64Array.from(lons), edges }
}

function graphFor(roads: Roads): Graph {
  if (built && built.roads === roads) return built.graph
  const graph = build(roads)
  built = { roads, graph }
  return graph
}

/** The graph node closest to a place, or null if the network is empty. */
function nearest(g: Graph, lat: number, lon: number): NodeId | null {
  let best: NodeId | null = null
  let bestD = Infinity
  for (let i = 0; i < g.lat.length; i++) {
    const d = km(lat, lon, g.lat[i], g.lon[i])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  // A place more than five kilometres from any classified road is a place
  // this network cannot speak about, and guessing would draw a route from
  // somewhere the rider is not.
  return bestD <= 5 ? best : null
}

export type Route = {
  /** The path, as [lat, lon] pairs ready to draw. */
  points: [number, number][]
  /** Distance along the roads. */
  km: number
  /** Straight-line distance, for comparison. */
  directKm: number
}

/**
 * A* from one place to another over the bundled network.
 *
 * A binary heap is overkill at this size and a sorted insert is not: six
 * thousand nodes with a good heuristic settles in a few milliseconds either
 * way, and the simpler one is the one that is obviously correct at seven in
 * the morning before a pitch.
 */
export function routeBetween(
  roads: Roads | null,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  /** Points to route away from. An edge ending near one costs several times
   *  as much, which bends the route around them where there is an
   *  alternative and lets it through where there is not. */
  avoid?: [number, number][],
): Route | null {
  const note = (why: string) => {
    if (typeof window !== 'undefined') {
      ;(window as unknown as Record<string, unknown>).__routeWhy = why
    }
  }
  if (!roads || roads.ways.length === 0) { note('no roads: ' + (roads ? roads.ways.length : 'null')); return null }

  const g = graphFor(roads)
  const start = nearest(g, from.lat, from.lon)
  const goal = nearest(g, to.lat, to.lon)
  if (start === null || goal === null || start === goal) { note(`snap start=${start} goal=${goal}`); return null }

  const h = (n: NodeId) => km(g.lat[n], g.lon[n], g.lat[goal], g.lon[goal])

  // Nodes to steer around, worked out once. A coarse grid keyed to about
  // two hundred metres, so the per-edge check is a lookup rather than a
  // scan across a few thousand coordinates.
  const avoidCells = new Set<string>()
  if (avoid) {
    for (const [la, lo] of avoid) {
      avoidCells.add(`${Math.round(la / 0.002)},${Math.round(lo / 0.002)}`)
    }
  }
  const nearAvoid = (la: number, lo: number): boolean => {
    if (avoidCells.size === 0) return false
    const r = Math.round(la / 0.002)
    const c = Math.round(lo / 0.002)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (avoidCells.has(`${r + dr},${c + dc}`)) return true
      }
    }
    return false
  }

  const cameFrom = new Map<NodeId, NodeId>()
  const cost = new Map<NodeId, number>([[start, 0]])
  const open: [number, NodeId][] = [[h(start), start]]
  const done = new Set<NodeId>()

  while (open.length > 0) {
    // Smallest f. Linear, because the frontier stays small on a road graph.
    let pick = 0
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[pick][0]) pick = i
    const [, current] = open.splice(pick, 1)[0]

    if (current === goal) break
    if (done.has(current)) continue
    done.add(current)

    for (const [next, d] of g.edges.get(current) ?? []) {
      if (done.has(next)) continue
      const tentative =
        (cost.get(current) ?? Infinity) + d * (nearAvoid(g.lat[next], g.lon[next]) ? 6 : 1)
      if (tentative < (cost.get(next) ?? Infinity)) {
        cost.set(next, tentative)
        cameFrom.set(next, current)
        open.push([tentative + h(next), next])
      }
    }
  }

  if (!cameFrom.has(goal)) { note('no path found'); return null }

  const points: [number, number][] = []
  let at: NodeId | undefined = goal
  while (at !== undefined) {
    points.push([g.lat[at], g.lon[at]])
    if (at === start) break
    at = cameFrom.get(at)
  }
  points.reverse()

  let along = 0
  for (let i = 1; i < points.length; i++) {
    along += km(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
  }

  note('ok ' + points.length + ' pts')
  return {
    points,
    km: Math.round(along * 10) / 10,
    directKm: Math.round(km(from.lat, from.lon, to.lat, to.lon) * 10) / 10,
  }
}

// ------------------------------------------------------------- navigating

export type Progress = {
  /** Index of the route point the rider is nearest. */
  at: number
  /** How far off the line they are, in km. Large means they have left it. */
  offKm: number
  /** Distance still to travel along the route. */
  remainingKm: number
  /** True once they are far enough off that the route no longer describes
   *  the journey. */
  offRoute: boolean
}

/** How far off the drawn line counts as no longer on it. Generous, because
 *  the network is simplified to about twenty metres and a dual carriageway
 *  is drawn as one line. */
const OFF_ROUTE_KM = 0.25

/**
 * Where along the route the rider is.
 *
 * Nearest-point rather than anything cleverer: the route is a few hundred
 * points and a phone can measure all of them several times a second without
 * noticing. Map-matching with heading and history would be better on a road
 * that doubles back on itself, and worse everywhere else, because it can
 * lock onto the wrong carriageway and refuse to let go.
 */
export function progressAlong(
  route: Route,
  position: { lat: number; lon: number },
): Progress {
  let at = 0
  let best = Infinity
  for (let i = 0; i < route.points.length; i++) {
    const d = km(position.lat, position.lon, route.points[i][0], route.points[i][1])
    if (d < best) {
      best = d
      at = i
    }
  }

  let remaining = 0
  for (let i = at + 1; i < route.points.length; i++) {
    remaining += km(
      route.points[i - 1][0],
      route.points[i - 1][1],
      route.points[i][0],
      route.points[i][1],
    )
  }

  return {
    at,
    offKm: Math.round(best * 100) / 100,
    remainingKm: Math.round(remaining * 10) / 10,
    offRoute: best > OFF_ROUTE_KM,
  }
}

/**
 * The next designated accident-prone stretch on the road ahead.
 *
 * This is the part a general-purpose navigator does not do, and the reason
 * this screen exists at all: not "turn left in 200 metres" but "the stretch
 * the authorities have designated starts in 1.4 kilometres". Only stretches
 * ahead of the rider count — one already passed is not a warning, it is
 * noise, and noise is how a warning stops being read.
 */
export function nextHazardAhead(
  route: Route,
  progress: Progress,
  hotspots: { id: string; label?: string; road?: string | null; points: unknown }[],
  /** How close a stretch has to come to the route to count as on it. */
  nearKm = 0.3,
): { id: string; label: string; road: string | null; km: number } | null {
  let bestKm = Infinity
  let found: { id: string; label: string; road: string | null; km: number } | null = null

  // Distance along the route to each point ahead, computed once.
  const ahead: { i: number; along: number }[] = []
  let along = 0
  for (let i = progress.at + 1; i < route.points.length; i++) {
    along += km(
      route.points[i - 1][0],
      route.points[i - 1][1],
      route.points[i][0],
      route.points[i][1],
    )
    ahead.push({ i, along })
  }

  for (const h of hotspots) {
    const pts = h.points as [number, number][]
    if (!Array.isArray(pts) || pts.length === 0) continue
    for (const { i, along: a } of ahead) {
      if (a >= bestKm) break
      const [rlat, rlon] = route.points[i]
      let near = Infinity
      for (const p of pts) {
        const d = km(rlat, rlon, p[0], p[1])
        if (d < near) near = d
      }
      if (near <= nearKm && a < bestKm) {
        bestKm = a
        found = {
          id: h.id,
          label: h.label ?? h.id,
          road: h.road ?? null,
          km: Math.round(a * 10) / 10,
        }
        break
      }
    }
  }

  return found
}

// -------------------------------------------------------- avoiding trouble

/**
 * The same journey, routed away from the designated stretches.
 *
 * Not a different algorithm — the same A*, with the cost of any edge that
 * runs near an officially designated accident-prone stretch multiplied. A
 * multiplier rather than a prohibition, because on an island with one
 * motorway some of those stretches have no alternative at all, and a router
 * that returns nothing is less use than one that returns the best available
 * compromise and says what it cost.
 *
 * The multiplier is six, set in routeBetween: high enough that a kilometre
 * of detour is worth taking to avoid a hundred metres of black spot, and low
 * enough that it will still route through one when the only other option is
 * twenty kilometres round.
 */
/** How close to a designated stretch counts as on it. */
const AVOID_KM = 0.25

export type Comparison = {
  direct: Route
  safer: Route | null
  /** Designated stretches each route passes within AVOID_KM of. */
  directSpots: number
  saferSpots: number
  /** Extra distance the safer one costs. */
  extraKm: number
}

/** How many designated stretches a route runs through. */
export function spotsOn(
  route: Route,
  hotspots: { points: unknown }[],
  nearKm = AVOID_KM,
): number {
  let n = 0
  for (const h of hotspots) {
    const pts = h.points as [number, number][]
    if (!Array.isArray(pts) || pts.length === 0) continue
    const hit = route.points.some((r) =>
      pts.some((p) => km(r[0], r[1], p[0], p[1]) <= nearKm),
    )
    if (hit) n++
  }
  return n
}

/**
 * Both routes, and what the safer one costs.
 *
 * Returns the safer route as null when it is the same road, which on this
 * island is often the honest answer and is worth saying out loud rather
 * than dressing a duplicate up as an alternative.
 */
export function compareRoutes(
  roads: Roads | null,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  hotspots: { points: unknown }[],
): Comparison | null {
  const direct = routeBetween(roads, from, to)
  if (!direct || !roads) return null

  const avoidPoints: [number, number][] = []
  for (const h of hotspots) {
    const pts = h.points as [number, number][]
    if (Array.isArray(pts)) avoidPoints.push(...pts)
  }

  const safer = routeBetween(roads, from, to, avoidPoints)
  const directSpots = spotsOn(direct, hotspots)
  const saferSpots = safer ? spotsOn(safer, hotspots) : directSpots

  const same =
    !safer ||
    (Math.abs(safer.km - direct.km) < 0.15 && saferSpots >= directSpots)

  return {
    direct,
    safer: same ? null : safer,
    directSpots,
    saferSpots,
    extraKm: safer ? Math.round((safer.km - direct.km) * 10) / 10 : 0,
  }
}
