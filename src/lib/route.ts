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
      const tentative = (cost.get(current) ?? Infinity) + d
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
