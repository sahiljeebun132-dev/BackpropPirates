// Does the promotion rule actually hold?
//
// The screen tells a rider that three reports within fifty metres is a road
// defect and anything less is one person's bump. That claim is worth exactly
// as much as the maths behind it, so this runs the real clustering function
// — the one the app imports, not a copy — over fixtures placed at measured
// distances and checks both halves of the rule: the fifty metres and the
// three reports.
//
//   node scripts/check_potholes.mjs
//
// Node 22.18 and later strip the types out of a .ts import on their own, so
// this needs no build step and no dependency.
import {
  CLUSTER_RADIUS_M,
  VERIFIED_MIN_REPORTS,
  clusterPotholes,
  maintenanceSummary,
  metresBetween,
} from '../src/lib/potholes.ts'

// Somewhere on the B28 out of Quartier Militaire. The exact spot does not
// matter; the latitude does, because it sets how wide a degree of longitude
// is, and these fixtures are offsets in metres from here.
const BASE = { lat: -20.164, lon: 57.498 }
const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LON = 111_320 * Math.cos((20.164 * Math.PI) / 180)

/** A report `north` metres north and `east` metres east of BASE. */
const at = (id, north, east, minutes) => ({
  id,
  lat: BASE.lat + north / M_PER_DEG_LAT,
  lon: BASE.lon + east / M_PER_DEG_LON,
  at: new Date(Date.UTC(2026, 10, 14, 6, minutes)).toISOString(),
})

let failures = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
}

console.log(`rule under test: ${VERIFIED_MIN_REPORTS} reports within ${CLUSTER_RADIUS_M} m\n`)

// --- the distance maths itself, before anything is built on it -------------

console.log('distance between two points, metres')
for (const [north, east] of [
  [10, 0],
  [0, 10],
  [50, 0],
  [0, 50],
  [30, 40],
]) {
  const d = metresBetween(BASE, at('x', north, east, 0))
  console.log(`  ${String(north).padStart(3)} m N, ${String(east).padStart(3)} m E  ->  ${d.toFixed(2)} m`)
  check(`  within 1 cm of ${Math.hypot(north, east)} m`, Math.abs(d - Math.hypot(north, east)) < 0.01, true)
}

// --- the three-report rule -------------------------------------------------

console.log('\nthe count rule, with every report inside 10 m of the others')
for (const n of [1, 2, 3, 4]) {
  const reports = Array.from({ length: n }, (_, i) => at(`r${i}`, i * 3, 0, i))
  const [cluster] = clusterPotholes(reports)
  console.log(
    `  ${n} report${n === 1 ? ' ' : 's'}  ->  count ${cluster.count}, ` +
      `${cluster.verified ? 'Verified road defect' : 'Unverified jolt'}`,
  )
  check(`  ${n} report${n === 1 ? '' : 's'} verified = ${n >= 3}`, cluster.verified, n >= 3)
}

// --- the fifty-metre rule --------------------------------------------------
//
// Two reports at the same spot, then a third at a measured distance. Either
// the third joins them and the group is promoted, or it stands alone and
// nothing is.

console.log('\nthe distance rule, third report at a measured offset')
for (const metres of [0, 25, 49, 51, 75]) {
  const clusters = clusterPotholes([at('a', 0, 0, 0), at('b', 0, 0, 1), at('c', metres, 0, 2)])
  const joined = clusters.length === 1
  console.log(
    `  third report ${String(metres).padStart(3)} m away  ->  ` +
      `${clusters.length} group${clusters.length === 1 ? ' ' : 's'}, ` +
      `counts ${clusters.map((c) => c.count).join('+')}, ` +
      `${clusters.some((c) => c.verified) ? 'Verified road defect' : 'nothing verified'}`,
  )
  check(`  ${metres} m joins = ${metres < CLUSTER_RADIUS_M}`, joined, metres < CLUSTER_RADIUS_M)
  check(
    `  ${metres} m promotes = ${metres < CLUSTER_RADIUS_M}`,
    clusters.some((c) => c.verified),
    metres < CLUSTER_RADIUS_M,
  )
}

// The boundary itself is not asserted, and that is deliberate rather than a
// gap. Building a fixture exactly 50 m away means dividing by the metres in
// a degree and multiplying back, which lands a few billionths of a metre
// either side of the line; and a GPS fix on an open road is wrong by several
// metres anyway, so which way the hair-fine case falls decides nothing real.
// It is printed rather than checked so the number is visible.
const edge = metresBetween(BASE, at('edge', CLUSTER_RADIUS_M, 0, 0))
console.log(
  `  a fixture built at exactly ${CLUSTER_RADIUS_M} m measures back as ` +
    `${edge.toFixed(12)} m, so the boundary case is left unasserted`,
)

// --- a run of potholes must not chain into one long "defect" ---------------
//
// Reports every 40 m along a road are each inside 50 m of the one before.
// Grouping by nearest member would swallow the lot into a single point that
// names nowhere in particular; grouping by the group's centre does not.

console.log('\na line of reports 40 m apart')
const line = [0, 40, 80, 120, 160].map((m, i) => at(`l${i}`, m, 0, i))
const chained = clusterPotholes(line)
console.log(
  `  5 reports over 160 m  ->  ${chained.length} groups, counts ${chained
    .map((c) => c.count)
    .join('+')}`,
)
check('  does not collapse into one group', chained.length > 1, true)

// --- order must not change the answer --------------------------------------

console.log('\nthe same reports, shuffled')
const set = [at('p', 0, 0, 0), at('q', 20, 0, 3), at('r', 10, 15, 6), at('s', 400, 0, 9)]
const forward = clusterPotholes(set)
const backward = clusterPotholes([...set].reverse())
console.log(`  forward  ${forward.map((c) => `${c.id}:${c.count}`).join(' ')}`)
console.log(`  reversed ${backward.map((c) => `${c.id}:${c.count}`).join(' ')}`)
check('  same groups either way', JSON.stringify(forward), JSON.stringify(backward))

// --- what a rider would actually send --------------------------------------

console.log('\nthe exported summary, from 4 reports at one spot and 1 on its own:\n')
const exported = clusterPotholes([
  at('v1', 0, 0, 0),
  at('v2', 5, 2, 7),
  at('v3', 2, 6, 31),
  at('v4', 8, 1, 95),
  at('u1', 900, 0, 40),
])
console.log(maintenanceSummary(exported, new Date(Date.UTC(2026, 10, 14, 9, 12))))

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECKS FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
