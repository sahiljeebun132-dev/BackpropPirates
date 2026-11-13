// How far wrong is the straight line?
//
// The app measures a corridor as the direct line between two towns and says
// so on screen. The Q&A answer calls that "a fair approximation on an island
// 65 km across". That has never been tested against a real road distance.
// These five are TomTom's road routes, measured tonight, against the app's
// own geo maths for the same pairs.
import { readFileSync } from 'node:fs'

const places = JSON.parse(readFileSync('public/data/places.json', 'utf8')).places
const by = (id) => {
  const p = places.find((x) => x.id === id)
  if (!p) throw new Error(`no place ${id}`)
  return p
}

// Exactly what src/lib/geo.ts does.
const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LON = 104.4
const straight = (a, b) =>
  Math.hypot((a.lon - b.lon) * KM_PER_DEG_LON, (a.lat - b.lat) * KM_PER_DEG_LAT)

// roadKm measured via the TomTom routing API, 2026-11-14 ~02:27 local.
const SAMPLES = [
  ['grand-baie', 'port-louis', 27.291],
  ['curepipe', 'port-louis', 23.96],
  ['grand-baie', 'centre-de-flacq', 39.697],
  ['port-louis', 'tamarin', 31.842],
  ['curepipe', 'centre-de-flacq', 28.456],
]

console.log('corridor                        straight   road    ratio')
const ratios = []
for (const [a, b, roadKm] of SAMPLES) {
  const s = straight(by(a), by(b))
  const r = roadKm / s
  ratios.push(r)
  console.log(
    `${(by(a).name + ' -> ' + by(b).name).padEnd(30)} ${s.toFixed(1).padStart(6)}  ${roadKm
      .toFixed(1)
      .padStart(6)}  ${r.toFixed(2).padStart(6)}`,
  )
}
ratios.sort((x, y) => x - y)
const mean = ratios.reduce((t, r) => t + r, 0) / ratios.length
console.log()
console.log(`ratio: min ${ratios[0].toFixed(2)}  median ${ratios[2].toFixed(2)}  max ${ratios.at(-1).toFixed(2)}  mean ${mean.toFixed(2)}`)
console.log(`so the straight line understates road distance by about ${Math.round((mean - 1) * 100)}% on this sample of ${ratios.length}.`)
