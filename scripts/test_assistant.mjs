// Run real questions through the real assistant and check the real answers.
//
// Two rules shaped this file.
//
// 1. It imports src/lib/assistant.ts itself rather than mirroring it.
//    check_score_spread.mjs reimplements risk.ts and carries a comment saying
//    the two will drift; a test that drifts from the thing it tests is worse
//    than no test. Node 24 strips the types on its own, and the one thing it
//    will not do is resolve an extensionless './risk', so the hook below adds
//    the .ts. That is the whole of the build step.
//
// 2. No expected figure is typed in. The route cases call assessRoute() with
//    the same arguments and assert the assistant reported that exact score;
//    the hospital case runs the same distanceKm() over emergency.json. So a
//    passing row means the assistant repeated the app, not that it matched a
//    number somebody once copied in here.
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const lib = (name) => pathToFileURL(join(root, 'src', 'lib', `${name}.ts`)).href
const { answer, EMERGENCY_NUMBERS } = await import(lib('assistant'))
const { assessRoute } = await import(lib('risk'))
const { distanceKm } = await import(lib('geo'))
const { GUIDES } = await import(lib('breakdown'))

// The same seven files useAppData.ts fetches at runtime.
const FILES = ['places', 'hotspots', 'districts', 'conditions', 'emergency', 'exposure', 'island']
const data = Object.fromEntries(
  FILES.map((n) => [n, JSON.parse(readFileSync(join(root, 'public', 'data', `${n}.json`), 'utf8'))]),
)

const place = (id) => {
  const found = data.places.places.find((p) => p.id === id)
  if (!found) throw new Error(`places.json has no place "${id}"`)
  return found
}

/** The score the app itself would show for this trip. */
const scoreFor = (fromId, toId, mode, band) =>
  assessRoute(data, place(fromId), place(toId), mode, band).score

/** The nearest hospital to a town, by the same maths the app uses. */
const nearestHospitalTo = (townId) => {
  const town = place(townId)
  return data.emergency.places
    .filter((p) => p.kind === 'hospital')
    .map((p) => ({ p, km: distanceKm(p, town) }))
    .sort((a, b) => a.km - b.km)[0]
}

// --- Checks a case can ask for -------------------------------------------

const guide = (id) => ({
  label: `guide ${id}`,
  run: (a) => (a.goTo?.guideId === id ? null : `goTo.guideId was ${a.goTo?.guideId ?? 'null'}`),
})

const vehicle = (v) => ({
  label: `vehicle ${v}`,
  run: (a) => (a.goTo?.vehicle === v ? null : `goTo.vehicle was ${a.goTo?.vehicle ?? 'null'}`),
})

const view = (v) => ({
  label: `view ${v}`,
  run: (a) => (a.goTo?.view === v ? null : `goTo.view was ${a.goTo?.view ?? 'null'}`),
})

const corridor = (fromId, toId) => ({
  label: `corridor ${fromId} to ${toId}`,
  run: (a) =>
    a.goTo?.originId === fromId && a.goTo?.destinationId === toId
      ? null
      : `goTo was ${a.goTo?.originId ?? 'null'} to ${a.goTo?.destinationId ?? 'null'}`,
})

const says = (...needles) => ({
  label: `says ${needles.join(' + ')}`,
  run: (a) => {
    const missing = needles.filter((n) => !a.reply.includes(n))
    return missing.length === 0 ? null : `reply lacks ${missing.map((m) => JSON.stringify(m)).join(', ')}`
  },
})

const lacks = (...needles) => ({
  label: `never says ${needles.join(' / ')}`,
  run: (a) => {
    const present = needles.filter((n) => a.reply.includes(n))
    return present.length === 0 ? null : `reply contains ${present.map((m) => JSON.stringify(m)).join(', ')}`
  },
})

const confidence = (c) => ({
  label: `confidence ${c}`,
  run: (a) => (a.confidence === c ? null : `confidence was ${a.confidence}`),
})

const noTarget = {
  label: 'goTo null',
  run: (a) => (a.goTo == null ? null : `goTo was ${JSON.stringify(a.goTo)}`),
}

/** Every answer must cite something, whatever the question was. */
const sourced = {
  label: 'carries a source',
  run: (a) => (typeof a.source === 'string' && a.source.length > 8 ? null : `source was ${JSON.stringify(a.source)}`),
}

// --- The questions -------------------------------------------------------

const CASES = [
  // 1. Roadside, car assumed because nothing in the question says otherwise.
  { q: 'my tyre is flat', expect: [guide('flat-tyre'), vehicle('car'), view('help'), confidence('high')] },
  { q: 'I have a puncture', expect: [guide('flat-tyre'), vehicle('car')] },
  { q: 'flat tyre on my bike', expect: [guide('moto-puncture'), vehicle('motorcycle')] },
  { q: 'puncture on my scooter, what do I do', expect: [guide('moto-puncture'), vehicle('motorcycle')] },

  // The first thing to do has to be in the reply, not just a link to it.
  {
    q: 'my tyre is flat',
    expect: [says(GUIDES.find((g) => g.id === 'flat-tyre').before[0])],
    note: 'first step quoted from the guide itself',
  },

  // 2. Routes. The expected score is computed, never typed.
  {
    q: 'how dangerous is Grand Baie to Curepipe',
    expect: [
      corridor('grand-baie', 'curepipe'),
      view('result'),
      says(`${scoreFor('grand-baie', 'curepipe', 'car', 'day')} out of 100`),
      says('2024'),
    ],
  },
  {
    q: 'is it safe to ride from Port Louis to Mahebourg at night',
    expect: [
      corridor('port-louis', 'mahebourg'),
      says(`${scoreFor('port-louis', 'mahebourg', 'motorcycle', 'night-unlit')} out of 100`),
      says('a motorcycle after dark on an unlit road'),
      confidence('high'),
    ],
    note: 'mode and light both stated, so nothing is assumed',
  },
  {
    q: 'how risky is walking from Rose Hill to Quatre Bornes',
    expect: [says(`${scoreFor('rose-hill', 'quatre-bornes', 'pedestrian', 'day')} out of 100`)],
  },
  {
    q: 'Curepipe to Port Louis by bus',
    expect: [says(`${scoreFor('curepipe', 'port-louis', 'bus', 'day')} out of 100`)],
  },
  {
    q: 'drive from Flic en Flac to Grand Baie',
    expect: [corridor('flic-en-flac', 'grand-baie')],
    note: 'two-word and three-word town names, matched longest first',
  },
  {
    q: 'how dangerous is Grand Baie to Curepipe',
    expect: [confidence('low'), says('I assumed')],
    note: 'no mode and no time given, so the assumption is declared',
  },
  {
    q: 'is the road to Port Louis safe',
    expect: [
      view('plan'),
      confidence('low'),
      says('only Port Louis', '2024'),
      lacks('out of 100'),
    ],
    note: 'one endpoint cannot make a corridor, so no score is invented',
  },
  {
    q: 'is Port Louis to Port Louis dangerous',
    expect: [says('named only Port Louis'), lacks('out of 100'), confidence('low')],
    note: 'one town twice is still one town, so there is no corridor of zero length to score',
  },

  // 3. Emergency places.
  {
    q: 'where is the nearest hospital',
    expect: [
      noTarget,
      confidence('low'),
      says(`${data.emergency.counts.hospital} hospitals`),
      says('cannot tell where you are'),
    ],
    note: 'no position in a pure function, so it says so instead of guessing one',
  },
  {
    q: 'nearest hospital to Curepipe',
    expect: [
      says(nearestHospitalTo('curepipe').p.name),
      says(`${nearestHospitalTo('curepipe').km.toFixed(1)} km`),
      confidence('high'),
    ],
  },
  {
    q: 'closest police station to Mahebourg',
    expect: [says(`${data.emergency.counts.police} police stations`), confidence('high')],
  },

  // 4. The numbers.
  {
    q: 'what number do I call',
    expect: [
      says(...EMERGENCY_NUMBERS.map((e) => e.number)),
      says('No app can dial these for you'),
      view('help'),
      confidence('high'),
    ],
    note: 'the three call buttons sit above BreakdownFlow’s stage switch, so the help screen opens onto them',
  },
  { q: 'who do I call if there is a crash', expect: [says('114', '999', '115')] },

  // 5. The rest of the symptoms.
  { q: 'my chain came off', expect: [guide('moto-chain'), vehicle('motorcycle')], note: 'chain implies a bike without being told' },
  { q: 'the car is overheating', expect: [guide('overheating'), vehicle('car')] },
  { q: 'my bike is overheating', expect: [guide('moto-overheating'), vehicle('motorcycle')] },
  { q: 'I ran out of fuel', expect: [guide('out-of-fuel')] },
  { q: 'out of petrol on my scooter', expect: [guide('moto-out-of-fuel')] },
  { q: 'a warning light came on', expect: [guide('warning-light'), vehicle('car')] },
  { q: 'my car will not start', expect: [guide('wont-start'), vehicle('car')] },
  { q: 'my battery is flat', expect: [guide('wont-start')], note: 'a flat battery is not a flat tyre' },
  { q: 'I can smell petrol', expect: [guide('smoke-or-smell')], note: 'a fuel smell is not an empty tank' },
  { q: 'there is smoke coming from my bike', expect: [guide('moto-fire')] },
  { q: 'how do I check the oil', expect: [guide('oil-check')] },
  { q: 'I dropped my bike', expect: [guide('moto-dropped')] },
  { q: 'my headlight is out', expect: [guide('moto-lights'), vehicle('motorcycle')] },
  {
    q: 'warning light on my motorcycle',
    expect: [vehicle('motorcycle'), confidence('low'), says('no guide for that on a bike')],
    note: 'there is no bike warning-light guide, so it does not hand over the car one',
  },

  // 6. Outside what it knows.
  {
    q: 'what is the capital of France',
    expect: [noTarget, confidence('low'), says('I cannot answer that'), says('I am not a chatbot')],
  },
  {
    q: 'will it rain tomorrow in Moka',
    expect: [lacks('out of 100')],
    note: 'a town name alone is not a route question',
  },
  { q: '', expect: [says('I cannot answer that'), noTarget] },
]

// --- Run -----------------------------------------------------------------

const rows = []
let failed = 0

for (const c of CASES) {
  const a = answer(c.q, data, undefined)
  const checks = [...c.expect, sourced]
  const problems = checks.map((chk) => ({ chk, why: chk.run(a) })).filter((r) => r.why !== null)
  if (problems.length) failed++
  rows.push({
    q: c.q === '' ? '(empty)' : c.q,
    expected: c.expect.map((e) => e.label).join('; '),
    ok: problems.length === 0,
    why: problems.map((p) => p.why).join(' | '),
    reply: a.reply,
    note: c.note,
  })
}

// --- The 114/999/115 cross-check -----------------------------------------
// The assistant must be quoting the app, not itself. These three numbers are
// only trustworthy because the same three are already wired to tel: links and
// into the fire guides, so check that is still true.
const appText = [
  'src/components/EmergencyList.tsx',
  'src/components/BreakdownFlow.tsx',
  'src/components/CrashWatch.tsx',
  'src/lib/breakdown.ts',
]
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n')

for (const { service, number } of EMERGENCY_NUMBERS) {
  const present = appText.includes(`tel:${number}`) || appText.includes(`on ${number}`)
  if (!present) failed++
  rows.push({
    q: `[cross-check] ${service} ${number}`,
    expected: 'already on screen in the app',
    ok: present,
    why: present ? '' : `${number} appears nowhere in the app's own call buttons or guide text`,
    reply: present ? `${number} is wired up in the app, so the assistant is quoting it, not inventing it` : '',
  })
}

// --- Print ---------------------------------------------------------------

const w = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))
const QW = 46
const EW = 52

console.log(`assistant: ${rows.length} checks over ${CASES.length} questions\n`)
console.log(`${'  '}${w('QUESTION', QW)}  ${w('EXPECTED', EW)}  RESULT`)
console.log('-'.repeat(QW + EW + 14))
for (const r of rows) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${w(r.q, QW)}  ${w(r.expected, EW)}  ${r.ok ? 'ok' : r.why}`)
}

console.log('\nwhat it actually said\n')
for (const r of rows) {
  if (!r.reply) continue
  console.log(`  ${r.q}`)
  if (r.note) console.log(`    (${r.note})`)
  console.log(`    ${r.reply}\n`)
}

const passed = rows.filter((r) => r.ok).length
console.log(`${passed}/${rows.length} checks passed, ${failed} question${failed === 1 ? '' : 's'} failed`)
if (failed) process.exit(1)
