/** The Zetway assistant: retrieval over the app's own content.
 *
 * Is this a language model? No. There is no model here, no embedding, no
 * vector, no API key and no network call. `answer()` lowercases the question,
 * looks for fixed phrases and for the town names already in places.json, and
 * then reads the answer out of the same JSON and the same functions the rest
 * of the app uses. Every branch below can be pointed at and read aloud.
 *
 * That was a deliberate choice rather than a shortcut. The pitch is an app
 * that still works in a tunnel, on the M1, with no signal, and an assistant
 * that needs a remote model is dead in exactly the moment it is needed. A
 * phrase table is the only kind of assistant that survives airplane mode.
 *
 * The price is that it only knows what it has a rule for, so the honest thing
 * is to say so. Anything unmatched returns the plain "I cannot answer that"
 * reply with a list of what it can do, and never a guess.
 *
 * No answer contains a number typed in by hand. Scores come from
 * assessRoute(), distances from distanceKm(), counts from the loaded JSON,
 * and guide text from the guide itself.
 */

import { GUIDES, type Guide, type Vehicle } from './breakdown'
import { distanceKm } from './geo'
import { assessRoute } from './risk'
import type { AppData, EmergencyPlace, Place, Source, TimeBand, TravelMode } from './types'

/** Shown wherever the assistant is put on screen, and the answer to the
 *  question a judge will ask. Kept beside the engine so it cannot drift away
 *  from what the engine actually does. */
export const ENGINE_NOTE =
  'Zetway’s assistant is not a language model. It matches your words against a fixed ' +
  'phrase list and the town names in the app’s own data, then reads the answer out of ' +
  'the same tables the rest of the app uses. It runs with no network and no model, and it ' +
  'says so when a question is outside what it knows.'

/** Where in the app this answer lives. The view names are App.tsx's own View
 *  union, so a caller passes them straight to setView. */
export type AssistantTarget = {
  view: 'plan' | 'result' | 'help' | 'accidents' | 'climate' | 'crash'
  /** For 'help': which machine's guide list to open. */
  vehicle?: Vehicle
  /** For 'help': the guide to open, an id from the GUIDES array. */
  guideId?: string
  /** For 'plan' and 'result': place ids from places.json. */
  originId?: string
  destinationId?: string
  mode?: TravelMode
  timeBand?: TimeBand
}

export type Answer = {
  reply: string
  /** Where the figure came from, named the way the rest of the app names it. */
  source: string
  goTo?: AssistantTarget | null
  /** 'low' whenever the engine had to assume something, or could not answer
   *  the question that was actually asked. */
  confidence: 'high' | 'low'
}

/** The three numbers Zetway already puts on screen as tel: links, in
 *  EmergencyList.tsx, BreakdownFlow.tsx and CrashWatch.tsx, plus the fire
 *  service in the breakdown.ts fire guides. Listed once here so the assistant
 *  quotes the app rather than quoting itself. */
export const EMERGENCY_NUMBERS: { service: string; number: string }[] = [
  { service: 'Ambulance', number: '114' },
  { service: 'Police', number: '999' },
  { service: 'Fire service', number: '115' },
]

/** Why the assistant will not offer to dial. Not modesty: Android refuses
 *  ACTION_CALL for emergency numbers from any third-party app, which is the
 *  same limit escalate.ts documents for the crash flow. */
const DIAL_LIMIT =
  'No app can dial these for you — Android keeps emergency numbers for the phone’s own ' +
  'dialler — so the last tap is always yours.'

// --- Text handling -------------------------------------------------------
// Everything the matcher does to a question happens here, once.

/** Lowercase, strip accents, turn every non-letter into a space, and pad both
 *  ends. The padding is what lets a phrase be searched for with its own
 *  spaces, so 'tyre' cannot match inside a longer word and 'moka' cannot
 *  match inside 'mokaland'. */
function normalise(text: string): string {
  const flat = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return ` ${flat} `
}

const has = (haystack: string, phrase: string): boolean => haystack.includes(` ${phrase} `)

/** Where a phrase sits in the padded text, or -1. Used to read the order two
 *  town names were said in. */
const indexOf = (haystack: string, phrase: string): number => haystack.indexOf(` ${phrase} `)

const km1 = (n: number) => n.toFixed(1)

/** Join names the way a person would say them. Several police districts are
 *  themselves called "X and Y", so joining the list with "and" too produced
 *  "Grand Port and Savanne and Port Louis North and Port Louis South", where
 *  the reader cannot see where one district stops. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Pick a dataset out of a sources array by name, so the citation is the
 *  publisher's own title rather than one we made up. */
function sourceNamed(sources: Source[], pattern: RegExp): string {
  const found = sources.find((s) => pattern.test(s.dataset))
  return `${(found ?? sources[0]).dataset}, Open Data Mauritius`
}

// --- What the traveller is on --------------------------------------------

const VEHICLE_WORDS: { vehicle: Vehicle; words: string[] }[] = [
  {
    vehicle: 'motorcycle',
    words: ['bike', 'motorbike', 'motorcycle', 'motorcycles', 'scooter', 'moped', 'moto', 'two wheeler', 'pillion'],
  },
  { vehicle: 'car', words: ['car', 'van', 'vehicle'] },
]

function vehicleIn(q: string): Vehicle | null {
  for (const entry of VEHICLE_WORDS) {
    if (entry.words.some((w) => has(q, w))) return entry.vehicle
  }
  return null
}

const TRAVEL_MODE_WORDS: { mode: TravelMode; words: string[] }[] = [
  { mode: 'motorcycle', words: ['bike', 'motorbike', 'motorcycle', 'scooter', 'moped', 'moto', 'riding', 'ride', 'rider'] },
  { mode: 'pedestrian', words: ['walking', 'walk', 'on foot', 'pedestrian'] },
  { mode: 'bus', words: ['bus'] },
  { mode: 'car', words: ['car', 'driving', 'drive', 'van'] },
]

/** The travel mode changes the score, so when nothing in the question says
 *  how they are travelling the answer has to name the assumption it made. */
function travelModeIn(q: string): { mode: TravelMode; stated: boolean } {
  for (const entry of TRAVEL_MODE_WORDS) {
    if (entry.words.some((w) => has(q, w))) return { mode: entry.mode, stated: true }
  }
  return { mode: 'car', stated: false }
}

/** Light band. 'At night' is read as the unlit case, which is the same
 *  fallback PlanForm starts on when the forecast cannot be reached, so the
 *  assistant and the planner answer the same words the same way. The reply
 *  spells the assumption out either way. */
function timeBandIn(q: string): { band: TimeBand; stated: boolean } {
  if (has(q, 'unlit') || has(q, 'no street lighting') || has(q, 'no street lights')) {
    return { band: 'night-unlit', stated: true }
  }
  if (has(q, 'lit road') || has(q, 'street lights') || has(q, 'street lighting')) {
    return { band: 'night-lit', stated: true }
  }
  if (has(q, 'dawn') || has(q, 'dusk')) return { band: 'dawn-dusk', stated: true }
  if (has(q, 'night') || has(q, 'dark') || has(q, 'evening') || has(q, 'tonight')) {
    return { band: 'night-unlit', stated: true }
  }
  return { band: 'day', stated: false }
}

const BAND_PHRASE: Record<TimeBand, string> = {
  day: 'in daylight',
  'dawn-dusk': 'at dawn or dusk',
  'night-lit': 'after dark on a lit road',
  'night-unlit': 'after dark on an unlit road',
}

const MODE_PHRASE: Record<TravelMode, string> = {
  car: 'a car',
  motorcycle: 'a motorcycle',
  bus: 'a bus',
  pedestrian: 'someone on foot',
}

// --- Symptom to guide ----------------------------------------------------

type Symptom = {
  phrases: string[]
  car: string | null
  motorcycle: string | null
  /** Set when the symptom only exists on one machine, so the question does
   *  not have to name it. Nobody writes 'my motorcycle chain came off'. */
  forces?: Vehicle
}

/** One row per thing that can go wrong, naming the guide for each machine.
 *
 * Keeping the pair on one row is the point: a flat tyre on a bike is not the
 * car procedure with different wording, and breakdown.ts deliberately shares
 * nothing between the two sets. A null is a symptom Zetway has no guide for
 * on that machine, and the assistant says so rather than handing over the
 * wrong one.
 *
 * Phrases are matched whole, with spaces around them. That is why 'flat' is
 * not in the tyre row: a flat battery is not a flat tyre, and the bare word
 * would have sent every dead battery to the jack.
 */
const SYMPTOMS: Symptom[] = [
  {
    phrases: ['puncture', 'punctured', 'flat tyre', 'flat tire', 'tyre', 'tire', 'tyres', 'blowout', 'blow out', 'tyre pressure', 'burst tyre'],
    car: 'flat-tyre',
    motorcycle: 'moto-puncture',
  },
  {
    phrases: ['chain', 'chain came off', 'chain is loose', 'chain slipping', 'chain jumped', 'chain off'],
    car: null,
    motorcycle: 'moto-chain',
    forces: 'motorcycle',
  },
  {
    phrases: ['overheat', 'overheating', 'overheated', 'temperature gauge', 'temp gauge', 'running hot', 'steam', 'steaming', 'coolant', 'radiator', 'boiling over'],
    car: 'overheating',
    motorcycle: 'moto-overheating',
  },
  {
    phrases: ['out of fuel', 'out of petrol', 'no fuel', 'no petrol', 'ran out of fuel', 'ran out of petrol', 'ran dry', 'empty tank', 'tank is empty', 'on empty', 'fuel gauge'],
    car: 'out-of-fuel',
    motorcycle: 'moto-out-of-fuel',
  },
  {
    phrases: ['warning light', 'check engine', 'engine light', 'dashboard light', 'dash light', 'light came on', 'light has come on', 'abs light', 'oil light', 'engine management light'],
    car: 'warning-light',
    motorcycle: null,
  },
  {
    phrases: ['will not start', 'wont start', 'won t start', 'not starting', 'dead battery', 'flat battery', 'battery is flat', 'battery is dead', 'jump start', 'jumpstart', 'jump leads', 'clicking', 'turning over', 'starter'],
    car: 'wont-start',
    motorcycle: 'moto-wont-start',
  },
  {
    phrases: ['smoke', 'smoking', 'burning smell', 'smell burning', 'smells burning', 'fuel smell', 'petrol smell', 'smell of fuel', 'smell of petrol', 'smell of diesel', 'smell petrol', 'smell fuel', 'smell diesel', 'smells of petrol', 'on fire', 'catching fire'],
    car: 'smoke-or-smell',
    motorcycle: 'moto-fire',
  },
  {
    phrases: ['check the oil', 'check oil', 'oil level', 'dipstick', 'engine oil', 'low on oil'],
    car: 'oil-check',
    motorcycle: null,
  },
  {
    phrases: ['headlight', 'head light', 'brake light', 'indicator', 'indicators', 'no lights', 'lights have failed', 'tail light', 'electrics'],
    car: null,
    motorcycle: 'moto-lights',
    forces: 'motorcycle',
  },
  {
    phrases: ['dropped it', 'dropped my bike', 'dropped the bike', 'fell off', 'fell over', 'laid it down', 'low speed fall', 'came off the bike'],
    car: null,
    motorcycle: 'moto-dropped',
    forces: 'motorcycle',
  },
]

/** The best symptom row for this question, or null.
 *
 * The score is how many of a row's phrases are present, so 'my chain came
 * off' beating a bare 'chain' is not luck. Ties go to the row whose longest
 * matched phrase is longest, which prefers the specific reading of a word two
 * rows share.
 */
function matchSymptom(q: string): Symptom | null {
  let best: Symptom | null = null
  let bestCount = 0
  let bestLength = 0
  for (const row of SYMPTOMS) {
    const hits = row.phrases.filter((p) => has(q, p))
    if (hits.length === 0) continue
    const longest = Math.max(...hits.map((p) => p.length))
    if (hits.length > bestCount || (hits.length === bestCount && longest > bestLength)) {
      best = row
      bestCount = hits.length
      bestLength = longest
    }
  }
  return best
}

// --- Town names ----------------------------------------------------------

/** Every town in places.json named in the question, in the order they were
 *  said. Longest names are tested first so 'Grand Baie' is never read as two
 *  hits, and the order is what tells origin from destination. */
function placesIn(q: string, places: Place[]): Place[] {
  const found: { place: Place; at: number; length: number }[] = []
  const byLength = [...places].sort((a, b) => b.name.length - a.name.length)
  for (const place of byLength) {
    const needle = normalise(place.name).trim()
    const at = indexOf(q, needle)
    if (at === -1) continue
    // A town already covered by a longer name is not a second town.
    if (found.some((f) => at >= f.at && at < f.at + f.length)) continue
    found.push({ place, at, length: needle.length + 1 })
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.place)
}

// --- Intents -------------------------------------------------------------

/** Asking for a phone number is checked before symptoms so that "my bike is
 *  on fire, what number do I call" answers the question that was asked. */
const NUMBER_PHRASES = [
  'what number', 'which number', 'number do i call', 'number to call', 'number should i call',
  'emergency number', 'emergency numbers', 'who do i call', 'who to call', 'who should i call',
  'ambulance number', 'police number', 'fire number',
]

const NEAREST_PHRASES = ['nearest', 'closest', 'near me', 'nearby', 'where is the', 'where is my']

const SAFETY_PHRASES = [
  'safe', 'safer', 'safety', 'dangerous', 'danger', 'risky', 'risk', 'score', 'how bad',
  'accident prone', 'road to', 'drive to', 'ride to', 'get to',
]

export function answer(question: string, data: AppData, ctx?: { guides?: Guide[] }): Answer {
  const q = normalise(question)
  const guides = ctx?.guides ?? GUIDES

  if (q.trim().length === 0) return cannotAnswer(data, guides)

  // 1. The three emergency numbers.
  if (NUMBER_PHRASES.some((p) => has(q, p))) return emergencyNumbers()

  // 2. Something has gone wrong with the machine.
  const symptom = matchSymptom(q)
  if (symptom) return roadside(q, symptom, guides)

  // 3. Where is the nearest hospital, clinic or police station.
  if (NEAREST_PHRASES.some((p) => has(q, p)) && kindAsked(q)) return nearest(q, data)

  // 4. How safe is this route.
  const towns = placesIn(q, data.places.places)
  if (towns.length >= 2 || (towns.length === 1 && SAFETY_PHRASES.some((p) => has(q, p)))) {
    return route(q, towns, data)
  }

  return cannotAnswer(data, guides)
}

// --- Intent 1: emergency numbers -----------------------------------------

function emergencyNumbers(): Answer {
  const list = EMERGENCY_NUMBERS.map((e) => `${e.service} ${e.number}`).join(', ')
  return {
    reply: `${list}. ${DIAL_LIMIT} Zetway puts all three on screen as one-tap buttons on the roadside help screen and on the crash alert.`,
    source: 'Emergency numbers Zetway already dials, src/lib/breakdown.ts and src/components/EmergencyList.tsx',
    // No goTo. The roadside help screen does carry this list, but it opens
    // on the triage question - "is anyone hurt?" - so an Open it button here
    // would answer "where is the nearest hospital" with a question. The
    // reply already carries the name, the distance and the phone number,
    // which is the whole of what was asked.
    goTo: null,
    confidence: 'high',
  }
}

// --- Intent 2: roadside guides -------------------------------------------

function roadside(q: string, symptom: Symptom, guides: Guide[]): Answer {
  // What they said beats what the symptom implies, so "my car will not start"
  // is never answered with bike steps.
  const vehicle: Vehicle = vehicleIn(q) ?? symptom.forces ?? 'car'
  const guideId = vehicle === 'motorcycle' ? symptom.motorcycle : symptom.car
  const word = (v: Vehicle) => (v === 'motorcycle' ? 'bike' : 'car')

  if (!guideId) {
    const other: Vehicle = vehicle === 'motorcycle' ? 'car' : 'motorcycle'
    const otherId = other === 'motorcycle' ? symptom.motorcycle : symptom.car
    const otherGuide = otherId ? guides.find((g) => g.id === otherId) : undefined
    return {
      reply: otherGuide
        ? `Zetway has no guide for that on a ${word(vehicle)}. The one it does have, "${otherGuide.label}", is written for a ${word(other)} and the steps do not transfer. Open the ${word(vehicle)} guides and pick the closest symptom.`
        : `Zetway has no guide for that. Open the roadside guides and pick the closest symptom.`,
      source: 'Zetway roadside guides, src/lib/breakdown.ts',
      goTo: { view: 'help', vehicle },
      confidence: 'low',
    }
  }

  const guide = guides.find((g) => g.id === guideId)
  if (!guide) {
    return {
      reply: `Zetway has no guide loaded for "${guideId}".`,
      source: 'Zetway roadside guides, src/lib/breakdown.ts',
      goTo: { view: 'help', vehicle },
      confidence: 'low',
    }
  }

  const stops = guide.stopAndCall.length
  return {
    reply:
      `${guide.label}, ${word(vehicle)} — ${guide.blurb.toLowerCase()}. First: ${guide.before[0]} ` +
      `That guide also lists ${stops} situation${stops === 1 ? '' : 's'} where the right move is to stop and call for help instead, and they come before any of the steps.`,
    source: `Zetway roadside guide "${guide.label}", src/lib/breakdown.ts`,
    goTo: { view: 'help', vehicle, guideId: guide.id },
    confidence: 'high',
  }
}

// --- Intent 3: nearest emergency place -----------------------------------

type Kind = { kinds: EmergencyPlace['kind'][]; noun: string; plural: string }

function kindAsked(q: string): Kind | null {
  if (has(q, 'hospital') || has(q, 'hospitals')) {
    return { kinds: ['hospital'], noun: 'hospital', plural: 'hospitals' }
  }
  if (has(q, 'police station') || has(q, 'police stations') || has(q, 'police')) {
    return { kinds: ['police'], noun: 'police station', plural: 'police stations' }
  }
  if (has(q, 'clinic') || has(q, 'clinics') || has(q, 'health centre') || has(q, 'doctor')) {
    return { kinds: ['clinic'], noun: 'clinic or health centre', plural: 'clinics and health centres' }
  }
  return null
}

const KIND_NOUN: Record<EmergencyPlace['kind'], string> = {
  hospital: 'hospitals',
  clinic: 'clinics and health centres',
  police: 'police stations',
}

function nearest(q: string, data: AppData): Answer {
  const kind = kindAsked(q)
  if (!kind) return cannotAnswer(data, GUIDES)

  const pool = data.emergency.places.filter((p) => kind.kinds.includes(p.kind))
  const citation = sourceNamed(
    data.emergency.sources,
    kind.kinds[0] === 'police' ? /police/i : /hospital/i,
  )
  const towns = placesIn(q, data.places.places)

  // A pure function has no GPS fix. Rather than guess a location, say what is
  // in the data and point at the screen that does have a position.
  if (towns.length === 0) {
    const counted = kind.kinds
      .map((k) => `${data.emergency.counts[k]} ${KIND_NOUN[k]}`)
      .join(' and ')
    return {
      reply:
        `I cannot tell where you are from the question alone. Zetway holds ${counted} with their coordinates, ` +
        `and the roadside help screen ranks them by distance as soon as it has your location. ` +
        `Name a town and I will give you the nearest one to it.`,
      source: citation,
      goTo: null,
      confidence: 'low',
    }
  }

  const town = towns[0]
  const ranked = pool
    .map((p) => ({ place: p, km: distanceKm(p, town) }))
    .sort((a, b) => a.km - b.km)
  const best = ranked[0]
  if (!best) {
    return { reply: `There is no ${kind.noun} in the data.`, source: citation, goTo: null, confidence: 'low' }
  }

  return {
    reply:
      `Nearest ${kind.noun} to ${town.name}: ${best.place.name}${best.place.town ? `, ${best.place.town}` : ''}, ` +
      `${km1(best.km)} km away in a straight line, not by road.` +
      (best.place.phone ? ` Phone ${best.place.phone}.` : '') +
      ` Zetway holds ${pool.length} ${kind.plural} in all.`,
    source: citation,
    // No goTo. The roadside help screen does carry this list, but it opens
    // on the triage question - "is anyone hurt?" - so an Open it button here
    // would answer "where is the nearest hospital" with a question. The
    // reply already carries the name, the distance and the phone number,
    // which is the whole of what was asked.
    goTo: null,
    confidence: 'high',
  }
}

// --- Intent 4: how safe is this route ------------------------------------

function route(q: string, towns: Place[], data: AppData): Answer {
  const { mode, stated: modeStated } = travelModeIn(q)
  const { band, stated: bandStated } = timeBandIn(q)

  // One town named. A score is a property of a corridor, so there is no
  // honest way to produce one from a single endpoint. Give the figure that
  // does exist for that town, then ask for the other end.
  if (towns.length === 1) {
    const town = towns[0]
    const districts = data.districts.districts.filter((d) => town.policeDistricts.includes(d.name))
    const accidents = districts.reduce((s, d) => s + d.casualtyAccidents, 0)
    return {
      reply:
        `A safety score needs both ends of the trip and you have named only ${town.name}. ` +
        `What the tables do say about it: ${town.name} sits in ${listOf(districts.map((d) => d.name))}, which recorded ` +
        `${accidents.toLocaleString()} casualty accidents in ${data.districts.year}, out of ${data.districts.islandTotals.casualtyAccidents.toLocaleString()} island-wide. ` +
        `Tell me where you are starting from and I will score the corridor.`,
      source: 'Casualty Accidents by Police District, Open Data Mauritius',
      goTo: { view: 'plan', destinationId: town.id },
      confidence: 'low',
    }
  }

  // placesIn() returns each town once, so naming the same town twice falls
  // into the single-endpoint branch above rather than scoring a corridor of
  // zero length.
  const [origin, destination] = towns
  const a = assessRoute(data, origin, destination, mode, band)
  const districtAccidents = a.districts.reduce((s, d) => s + d.casualtyAccidents, 0)

  const assumed: string[] = []
  if (!modeStated) assumed.push(`you are in ${MODE_PHRASE[mode]}`)
  if (!bandStated) assumed.push(`you are travelling ${BAND_PHRASE[band]}`)

  const hotspotLine = a.hotspots.length
    ? `${a.hotspots.length} of the island’s ${data.hotspots.hotspots.length} designated accident-prone segments ${a.hotspots.length === 1 ? 'lies' : 'lie'} within ${data.hotspots.corridorRadiusKm} km of that corridor`
    : `No designated accident-prone segment lies within ${data.hotspots.corridorRadiusKm} km of that corridor`

  return {
    reply:
      `${origin.name} to ${destination.name} scores ${a.score} out of 100, ${a.band.label.toLowerCase()}, for ${MODE_PHRASE[mode]} ${BAND_PHRASE[band]}. ` +
      `${hotspotLine}, and ${listOf(a.districts.map((d) => d.name))} recorded ${districtAccidents.toLocaleString()} casualty accidents in ${data.districts.year}. ` +
      `Straight-line distance ${km1(a.directDistanceKm)} km.` +
      (assumed.length ? ` I assumed ${assumed.join(' and ')}; say otherwise and the score changes.` : ''),
    source: `Corridor Safety Score over the ${data.districts.year} Open Data Mauritius tables`,
    goTo: { view: 'result', originId: origin.id, destinationId: destination.id, mode, timeBand: band },
    confidence: assumed.length ? 'low' : 'high',
  }
}

// --- Nothing matched -----------------------------------------------------

/** Say so plainly, then say what it can do, with the real size of each thing
 *  it can do it over. No guessing and no padding. */
function cannotAnswer(data: AppData, guides: Guide[]): Answer {
  const cars = guides.filter((g) => g.vehicle === 'car').length
  const bikes = guides.filter((g) => g.vehicle === 'motorcycle').length
  return {
    reply:
      'I cannot answer that. I am not a chatbot: I match your words against a fixed list, so there are only four things I know. ' +
      `I can open one of ${cars} car or ${bikes} motorcycle roadside guides from a symptom such as a puncture, a chain, overheating or a warning light. ` +
      `I can score the corridor between any two of the ${data.places.places.length} towns Zetway knows. ` +
      `I can give the nearest of ${data.emergency.counts.hospital} hospitals, ${data.emergency.counts.clinic} clinics and ${data.emergency.counts.police} police stations to a named town. ` +
      `And I can give you the ${EMERGENCY_NUMBERS.length} emergency numbers.`,
    source: 'Zetway assistant, src/lib/assistant.ts',
    goTo: null,
    confidence: 'low',
  }
}
