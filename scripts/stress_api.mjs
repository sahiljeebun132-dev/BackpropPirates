/** Load-check the deployed read path, politely.
 *
 * There is exactly one serverless function in this project, api/reports.ts,
 * and only its GET is read-only: POST writes a hazard report to the blob store
 * and DELETE purges expired ones. Neither belongs in a load test — a stress
 * run that posted would fill the live feed real riders are reading with
 * rubbish. So this file only ever issues GET, and the one place a method is
 * named is the constant below.
 *
 * It is also deliberately small. This is a hobby-plan Vercel deployment hours
 * before a demo, not a target: 20 concurrent at most, under 300 requests in
 * total, done in a few seconds.
 *
 *   node scripts/stress_api.mjs [--base=https://backprop-pirates.vercel.app]
 */

import { readFileSync } from 'node:fs'

const METHOD = 'GET' // the only method this script may use
const DEFAULT_BASE = 'https://backprop-pirates.vercel.app'
const base = process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? DEFAULT_BASE
const TIMEOUT_MS = 10_000

const places = JSON.parse(
  readFileSync(new URL('../public/data/places.json', import.meta.url), 'utf8'),
).places

/** Real town coordinates, so the function does the distance filtering it does
 *  in production rather than taking an empty-query shortcut. */
const urls = places.map(
  (p) => `${base}/api/reports?lat=${p.lat}&lon=${p.lon}&km=${5 + (p.facilityCount % 10)}`,
)

const samples = []

async function one(url) {
  const started = performance.now()
  try {
    const res = await fetch(url, { method: METHOD, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const text = await res.text() // read the body: time to last byte, not to headers
    const ms = performance.now() - started
    // A 200 carrying something other than a report feed is not a success.
    let shaped = false
    try {
      shaped = Array.isArray(JSON.parse(text).reports)
    } catch {
      shaped = false
    }
    return { ms, status: res.status, ok: res.ok && shaped, shaped }
  } catch (err) {
    return { ms: performance.now() - started, status: 0, ok: false, error: err.name ?? 'error' }
  }
}

/** Fixed pool: `concurrency` workers pulling from one queue, so the number of
 *  requests in flight is exactly what the label says. */
async function phase(label, total, concurrency) {
  const results = []
  let next = 0
  const started = performance.now()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < total) {
        const i = next++
        results.push(await one(urls[i % urls.length]))
      }
    }),
  )
  const seconds = (performance.now() - started) / 1000
  samples.push({ label, concurrency, seconds, results })
  report(label, concurrency, seconds, results)
}

function report(label, concurrency, seconds, results) {
  const lat = results.map((r) => r.ms).sort((a, b) => a - b)
  const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]
  const ok = results.filter((r) => r.ok).length
  const codes = {}
  for (const r of results) {
    const key = r.error ?? String(r.status)
    codes[key] = (codes[key] ?? 0) + 1
  }
  const ms = (n) => `${n.toFixed(0)} ms`
  console.log(`
${label}  (concurrency ${concurrency})`)
  console.log(`  requests sent   ${results.length} in ${seconds.toFixed(2)} s  (${(results.length / seconds).toFixed(1)}/s)`)
  console.log(`  success rate    ${((100 * ok) / results.length).toFixed(1)}%  (${ok}/${results.length})`)
  console.log(`  responses       ${Object.entries(codes).map(([k, v]) => `${k} x${v}`).join('  ')}`)
  console.log(`  latency         p50 ${ms(q(0.5))}   p95 ${ms(q(0.95))}   p99 ${ms(q(0.99))}   min ${ms(lat[0])}   max ${ms(lat[lat.length - 1])}`)
}

console.log(`target: ${base}/api/reports   method: ${METHOD} only (POST and DELETE are never sent)`)

// One request on its own first. Vercel functions cold-start, and a cold start
// folded into the concurrent numbers would be read as queueing.
const cold = await one(urls[0])
console.log(`cold request:   ${cold.status} in ${cold.ms.toFixed(0)} ms`)

await phase('warm, one at a time', 20, 1)
await phase('concurrent', 200, 20)

const all = samples.flatMap((s) => s.results)
const okAll = all.filter((r) => r.ok).length
const latAll = all.map((r) => r.ms).sort((a, b) => a - b)
const qa = (p) => latAll[Math.min(latAll.length - 1, Math.floor(p * latAll.length))]
console.log(`
overall: ${all.length + 1} requests sent, ${((100 * (okAll + (cold.ok ? 1 : 0))) / (all.length + 1)).toFixed(1)}% success, p50 ${qa(0.5).toFixed(0)} ms, p95 ${qa(0.95).toFixed(0)} ms, p99 ${qa(0.99).toFixed(0)} ms`)

const failures = all.length - okAll
process.exit(failures > 0 ? 1 : 0)
