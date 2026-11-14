// Does the router produce a road, or a line with extra steps?
//
// The map used to draw origin to destination straight, which on an island
// with one motorway and a mountain in the middle crosses country nobody
// drives through. The test for a router here is not "did it return a path"
// but "is the path the length a road would be": measured earlier against
// real TomTom routes, the straight line understates road distance by about
// 42%, so a credible route should come back roughly 1.2 to 1.7 times the
// direct line. Much under that and it is cutting through fields; much over
// and it is wandering.
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !path.extname(spec)) {
      try {
        return next(spec + '.ts', ctx)
      } catch {
        /* fall through */
      }
    }
    return next(spec, ctx)
  },
})

const { routeBetween, km } = await import(pathToFileURL(path.join(ROOT, 'src/lib/route.ts')).href)

const roads = JSON.parse(readFileSync('public/data/roads.json', 'utf8'))
const places = JSON.parse(readFileSync('public/data/places.json', 'utf8')).places
const by = (id) => {
  const p = places.find((x) => x.id === id)
  if (!p) throw new Error(`no place ${id}`)
  return p
}

console.log(`network: ${roads.ways.length} ways\n`)

const PAIRS = [
  ['bon-accueil', 'rose-belle'],
  ['grand-baie', 'port-louis'],
  ['curepipe', 'port-louis'],
  ['grand-baie', 'centre-de-flacq'],
  ['port-louis', 'tamarin'],
  ['curepipe', 'centre-de-flacq'],
  ['mahebourg', 'port-louis'],
  ['goodlands', 'port-louis'],
]

let fail = 0
const ratios = []
const t0 = Date.now()

console.log('corridor                          direct   road   ratio  pts   ms')
for (const [a, b] of PAIRS) {
  const from = by(a)
  const to = by(b)
  const started = Date.now()
  const r = routeBetween(roads, from, to)
  const ms = Date.now() - started

  if (!r) {
    console.log(`${(from.name + ' -> ' + to.name).padEnd(32)}  NO ROUTE`)
    fail++
    continue
  }
  const ratio = r.km / r.directKm
  ratios.push(ratio)
  const bad = ratio < 1.05 || ratio > 2.2
  if (bad) fail++
  console.log(
    `${(from.name + ' -> ' + to.name).padEnd(32)} ${r.directKm.toFixed(1).padStart(6)} ${r.km
      .toFixed(1)
      .padStart(6)} ${ratio.toFixed(2).padStart(6)} ${String(r.points.length).padStart(5)} ${String(ms).padStart(4)}${bad ? '   <-- implausible' : ''}`,
  )

  // Every point on the route has to be somewhere on the island, not an
  // artefact of a bad snap.
  for (const [lat, lon] of r.points) {
    if (lat < -20.9 || lat > -19.8 || lon < 57.1 || lon > 57.9) {
      console.log(`    point outside Mauritius: ${lat}, ${lon}`)
      fail++
      break
    }
  }

  // And consecutive points must be close together, or the path has jumped
  // across a gap in the network rather than followed a road.
  let maxHop = 0
  for (let i = 1; i < r.points.length; i++) {
    maxHop = Math.max(maxHop, km(r.points[i - 1][0], r.points[i - 1][1], r.points[i][0], r.points[i][1]))
  }
  if (maxHop > 3) {
    console.log(`    longest single hop ${maxHop.toFixed(1)} km — the path jumps`)
    fail++
  }
}

ratios.sort((x, y) => x - y)
const mean = ratios.reduce((t, r) => t + r, 0) / (ratios.length || 1)
console.log()
console.log(
  `ratio: min ${ratios[0]?.toFixed(2)}  median ${ratios[Math.floor(ratios.length / 2)]?.toFixed(2)}  max ${ratios.at(-1)?.toFixed(2)}  mean ${mean.toFixed(2)}`,
)
console.log(`${PAIRS.length} routes in ${Date.now() - t0} ms`)
console.log(fail === 0 ? '\nOK  every route plausible and continuous' : `\n${fail} problem(s)`)
process.exit(fail === 0 ? 0 : 1)
