// Fail the build when the Corridor Safety Score stops discriminating.
//
// check_score_spread.mjs already prints the distribution across every
// route/mode/time combination, but it always exits 0. A data rebuild that
// flattened every corridor onto the same number, or shifted the whole scale
// so that the typical trip reads "Lower risk", would still show a green tick.
// The score is the product, so that has to be a build failure.
//
// Nothing here is a number we picked. The band edges are read out of
// scoreBand() in src/lib/risk.ts — the same thresholds the app puts on screen
// — so this guard moves with the product instead of drifting away from it.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (msg) => {
  console.error(`FAIL  ${msg}`)
  process.exitCode = 1
}

// check_score_spread.mjs resolves public/data relative to the working
// directory, so it has to be run from the repo root whatever cwd CI uses.
const run = spawnSync(process.execPath, [join(root, 'scripts', 'check_score_spread.mjs')], {
  cwd: root,
  encoding: 'utf8',
})
process.stdout.write(run.stdout ?? '')
if (run.stderr) process.stderr.write(run.stderr)
if (run.status !== 0) {
  console.error(`\nFAIL  check_score_spread.mjs exited ${run.status}`)
  process.exit(1)
}

const out = run.stdout ?? ''

// --- Band edges, taken from the app ---------------------------------------
const risk = readFileSync(join(root, 'src', 'lib', 'risk.ts'), 'utf8')
const fnStart = risk.indexOf('export function scoreBand')
const body = fnStart === -1 ? '' : risk.slice(fnStart, risk.indexOf('\n}', fnStart))
const cuts = [...body.matchAll(/score >= (\d+)/g)].map((m) => Number(m[1]))
if (cuts.length !== 3) {
  console.error('FAIL  could not read the four score bands out of src/lib/risk.ts scoreBand().')
  console.error('      This guard compares against the app\u2019s own thresholds; update it with the app.')
  process.exit(1)
}
const [goodAt, moderateAt, highAt] = cuts // 80 / 65 / 50 at the time of writing
const edges = [0, highAt, moderateAt, goodAt, 100]
const narrowestBand = Math.min(...edges.slice(1).map((e, i) => e - edges[i]))

// --- What the spread script measured --------------------------------------
const m = out.match(/^score\s+min\s+(-?\d+)\s+p10\s+(-?\d+)\s+median\s+(-?\d+)\s+p90\s+(-?\d+)\s+max\s+(-?\d+)/m)
if (!m) {
  console.error('\nFAIL  check_score_spread.mjs printed no "score min ... max" line to parse.')
  process.exit(1)
}
const [min, p10, median, p90, max] = m.slice(1).map(Number)

const bandsLine = out.match(/^bands\s+(.*)$/m)
if (!bandsLine) {
  console.error('\nFAIL  check_score_spread.mjs printed no "bands" line to parse.')
  process.exit(1)
}
const bandPct = Object.fromEntries(
  [...bandsLine[1].matchAll(/(\w+)\s+(\d+)%/g)].map((b) => [b[1], Number(b[2])]),
)

console.log('\ncalibration guard')
console.log(`  bands from risk.ts     severe <${highAt}  high <${moderateAt}  moderate <${goodAt}  good \u2265${goodAt}`)

// --- 1. The typical route must not sit at either extreme of the scale -----
// Above the "Lower risk" line the app is telling most riders that most trips
// are fine, which is not what the casualty tables say. Below the "High risk"
// line every trip reads the same alarm and the score carries no information.
if (median < highAt || median >= goodAt) {
  fail(`median ${median} is outside ${highAt}..${goodAt - 1}: the typical route no longer reads as moderate or high risk.`)
} else {
  console.log(`  median ${median}                in ${highAt}..${goodAt - 1}  ok`)
}

// --- 2. The spread must stay wider than a single band ---------------------
// If the middle 80% of routes fit inside one band, every rider sees the same
// verdict and the ranking is dead even though the numbers still move.
const spread = p90 - p10
if (spread < narrowestBand) {
  fail(`p10..p90 spans ${spread} points, narrower than the tightest band (${narrowestBand}): the spread has collapsed.`)
} else {
  console.log(`  p10..p90 spans ${spread}         \u2265 ${narrowestBand}     ok`)
}

// --- 3. All four verdicts must be reachable -------------------------------
// A band nothing lands in is a band the app can never show. Percentages come
// from the spread script and are rounded, so 0% means at most a handful of
// the 5,200 combinations reach it.
const empty = ['good', 'moderate', 'high', 'severe'].filter((b) => !bandPct[b])
if (empty.length) {
  fail(`no route reaches the ${empty.join(', ')} band: ${bandsLine[1].trim()}`)
} else {
  console.log(`  every band reachable      ${bandsLine[1].trim()}`)
}

console.log(`  range ${min}..${max}`)
if (process.exitCode) console.error('\nScore calibration drifted. Fix the data or the scoring, not this check.')
else console.log('\nPASS  score calibration')
