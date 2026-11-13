/** Stress the Corridor Safety Score: every combination, repeatedly, every
 *  result checked.
 *
 * check_score_spread.mjs asks whether the scores are *sensible*. This asks
 * whether the engine is fast enough to run on every keystroke, whether it is
 * pure, and whether it can ever hand the UI something malformed.
 *
 * It imports src/lib/risk.ts directly rather than reimplementing it. Node 24
 * strips the types itself; the only thing missing is extension-less relative
 * imports, which the resolve hook below supplies. So this measures the code
 * the app actually ships, and it cannot drift from it the way the mirrored
 * copy in check_score_spread.mjs can.
 *
 *   node scripts/stress_score.mjs [--seconds=10]
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

// src/lib writes `from './geo'`; the bundler fills in the extension and Node
// does not. Try the .ts file first, fall back so node: and bare specifiers
// still resolve normally.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context)
      } catch {
        /* not a TypeScript module; fall through */
      }
    }
    return next(specifier, context)
  },
})

const { assessRoute, scoreBand, WEIGHTS } = await import(
  new URL('../src/lib/risk.ts', import.meta.url).href
)

const SECONDS = Number(process.argv.find((a) => a.startsWith('--seconds='))?.slice(10) ?? 10)

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'))

const data = {
  places: load('places'),
  hotspots: load('hotspots'),
  districts: load('districts'),
  conditions: load('conditions'),
  exposure: load('exposure'),
  emergency: load('emergency'),
  island: load('island'),
}

const MODES = ['car', 'motorcycle', 'bus', 'pedestrian']
const BANDS = ['day', 'dawn-dusk', 'night-lit', 'night-unlit']

// Unordered town pairs, matching check_score_spread.mjs: the score is
// symmetric (the corridor, the district union and the distance all are), so
// scoring B->A as well would only double the work for identical numbers.
const places = data.places.places
const combos = []
for (let i = 0; i < places.length; i++) {
  for (let j = i + 1; j < places.length; j++) {
    for (const mode of MODES) {
      for (const band of BANDS) combos.push([places[i], places[j], mode, band])
    }
  }
}

/** Timings live in typed arrays on purpose: their backing stores are external
 *  to the V8 heap, so holding a few hundred thousand samples does not show up
 *  as the engine leaking memory in the figure we are trying to measure. */
const CHUNK = 1 << 20
const chunks = [new Float64Array(CHUNK)]
let sampleCount = 0
const record = (ms) => {
  const slot = sampleCount % CHUNK
  if (slot === 0 && sampleCount > 0) chunks.push(new Float64Array(CHUNK))
  chunks[chunks.length - 1][slot] = ms
  sampleCount++
}

// Pass 1's scores, kept to prove later passes agree with it.
const baseline = new Int16Array(combos.length)

const violations = []
const KEEP = 20
let checked = 0

function check(pass, index, [origin, destination, mode, band], result) {
  checked++
  const where = `${origin.name}->${destination.name} ${mode}/${band} (pass ${pass})`
  const fail = (what, saw) => {
    if (violations.length < KEEP) violations.push(`${what}: ${saw}  ${where}`)
    else violations.overflow = (violations.overflow ?? 0) + 1
  }

  const { score, factors } = result
  if (!Number.isInteger(score) || score < 0 || score > 100) fail('score not an integer 0-100', score)

  const expected = scoreBand(score)
  if (result.band.label !== expected.label || result.band.tone !== expected.tone) {
    fail('band does not match score', `${score} -> ${result.band.label}/${result.band.tone}`)
  }

  let weightSum = 0
  for (const f of factors) {
    weightSum += f.weight
    // The UI prints WEIGHTS on screen and invites a judge to argue with it.
    // A factor carrying a different weight than the one shown would make that
    // panel a lie, so check the two agree rather than only that they total 1.
    if (f.weight !== WEIGHTS[f.key]) fail(`factor ${f.key} weight differs from WEIGHTS`, String(f.weight))
    if (!Number.isFinite(f.risk)) fail(`factor ${f.key} risk not finite`, String(f.risk))
    else if (f.risk < 0 || f.risk > 1) fail(`factor ${f.key} risk outside 0-1`, String(f.risk))
    if (!Number.isFinite(f.risk * f.weight)) fail(`factor ${f.key} contribution not finite`, 'NaN')
  }
  // Exact, not approximate: 0.35 + 0.25 + 0.25 + 0.15 lands on 1 in IEEE 754,
  // so any drift here means a weight changed rather than a rounding artefact.
  if (weightSum !== 1) fail('factor weights do not sum to 1', String(weightSum))

  if (pass === 1) baseline[index] = score
  else if (baseline[index] !== score) {
    fail('score changed between passes', `${baseline[index]} -> ${score}`)
  }
}

// Mutating the shared AppData would make the engine impure in the way that
// matters most: the second render of the same route would disagree with the
// first. Hash it before and after rather than take that on trust.
const digest = () => createHash('sha256').update(JSON.stringify(data)).digest('hex')
const dataBefore = digest()

console.log(`combinations: ${combos.length}  (${places.length} towns, ${MODES.length} modes, ${BANDS.length} time bands)`)

// One untimed pass first: the numbers below should describe the engine the
// user meets on their second interaction, not V8 still compiling it.
const warmStart = performance.now()
for (const [o, d, m, t] of combos) assessRoute(data, o, d, m, t)
const warmMs = performance.now() - warmStart
console.log(`warm-up pass:  ${warmMs.toFixed(0)} ms for ${combos.length} scores`)

let peakHeap = process.memoryUsage().heapUsed
const heapAtStart = peakHeap
let passes = 0
const runStart = performance.now()

while ((performance.now() - runStart) / 1000 < SECONDS) {
  passes++
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i]
    const t0 = performance.now()
    const result = assessRoute(data, c[0], c[1], c[2], c[3])
    record(performance.now() - t0)
    check(passes, i, c, result)
    // Cheap enough every 500 scores, and often enough to catch a peak that a
    // once-per-pass reading would sit either side of.
    if ((i & 511) === 0) {
      const used = process.memoryUsage().heapUsed
      if (used > peakHeap) peakHeap = used
    }
  }
}

const elapsed = (performance.now() - runStart) / 1000
const afterHeap = process.memoryUsage()
if (afterHeap.heapUsed > peakHeap) peakHeap = afterHeap.heapUsed
const dataAfter = digest()

const all = new Float64Array(sampleCount)
for (let i = 0; i < sampleCount; i++) all[i] = chunks[(i / CHUNK) | 0][i % CHUNK]
const sorted = all.slice().sort()
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const mean = all.reduce((s, v) => s + v, 0) / sampleCount
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const us = (ms) => `${(ms * 1000).toFixed(1)} us`

console.log(`
ran ${passes} full passes in ${elapsed.toFixed(2)} s`)
console.log(`scores computed:  ${sampleCount.toLocaleString()}`)
console.log(`throughput:       ${Math.round(sampleCount / elapsed).toLocaleString()} scores/second`)
console.log(`one score:        mean ${us(mean)}   p50 ${us(q(0.5))}   p99 ${us(q(0.99))}   p99.9 ${us(q(0.999))}   max ${us(sorted[sorted.length - 1])}`)
console.log(`heap used:        ${mb(heapAtStart)} at start, peak ${mb(peakHeap)}, ${mb(afterHeap.heapUsed)} at end`)
console.log(`rss at end:       ${mb(afterHeap.rss)}`)
console.log(`input data:       ${dataBefore === dataAfter ? 'unchanged (sha256 matches)' : 'MUTATED BY SCORING'}`)
console.log(`invariants:       ${(checked * 1).toLocaleString()} results checked, ${violations.length + (violations.overflow ?? 0)} violations`)

if (violations.length) {
  console.log('\nviolations:')
  for (const v of violations) console.log(`  ${v}`)
  if (violations.overflow) console.log(`  ...and ${violations.overflow} more`)
}

const failed = violations.length > 0 || dataBefore !== dataAfter
console.log(failed ? '\nFAIL' : '\nOK  every result an integer 0-100, band matching, weights summing to 1, no NaN')
process.exit(failed ? 1 : 0)
