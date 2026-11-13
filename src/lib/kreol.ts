import type { Place } from './types'

/**
 * Hearing a hazard reported in Mauritian Kreol.
 *
 * No phone on sale has a Morisyen speech model. Android, iOS and every
 * browser engine ship French, English and a few dozen others; Kreol is not
 * among them, and pretending otherwise would be the easiest lie in this app
 * to tell and the quickest to be caught on stage.
 *
 * What works instead is a property of the language rather than a trick:
 * Kreol is French-lexified, so a French recogniser hears most of it as
 * something close. "Delo lor sime" comes back as "de l'eau sur chemin" or
 * "de lo lor si me" — mangled, but the water and the road survive. So the
 * app listens in French and matches on roots rather than on whole words,
 * which is why the table below carries fragments like "delo" and "dilo" and
 * "de l eau" side by side.
 *
 * It is a rule table, not a model. Thirty-odd phrases, each mapped to one of
 * the five kinds the hazard route already accepts, scored by how much of the
 * phrase was actually heard. Everything about that is inspectable, which is
 * the point: a judge can read the whole vocabulary in a minute and see
 * exactly why a sentence became a flood pin.
 *
 * The match is deliberately conservative. A transcript that hits nothing
 * returns null and the rider taps instead — dropping a wrong pin on a shared
 * map is worse than dropping none, because the next rider acts on it.
 */

export type HazardKind = 'crash' | 'blocked' | 'flood' | 'hazard' | 'police'

export type HeardHazard = {
  kind: HazardKind
  /** The words that triggered it, so the screen can show its working. */
  matched: string[]
  /** A place from places.json, when the speaker named one. */
  place: Place | null
  /** 'sure' when several words agreed, 'unsure' on a single weak hit. */
  confidence: 'sure' | 'unsure'
  /** What to put in the report's note, in the rider's own words. */
  note: string
}

/** Roots rather than words. A French recogniser hearing Kreol produces
 *  spellings nobody planned for, so these are matched as substrings of a
 *  flattened transcript. */
const LEXICON: { kind: HazardKind; roots: string[]; weight: number }[] = [
  {
    kind: 'flood',
    // delo / dilo = water. inonde, deborde. "lapli" = rain.
    roots: ['delo', 'dilo', 'de l eau', 'deleau', 'inond', 'inonde', 'deborde', 'lapli', 'flood', 'water on'],
    weight: 2,
  },
  {
    kind: 'crash',
    // aksidan / accident, "loto fine tape" = car hit, "kraze" = smashed.
    roots: ['aksidan', 'accident', 'tape', 'kraze', 'crash', 'collision', 'choc', 'fine tape'],
    weight: 2,
  },
  {
    kind: 'blocked',
    // "sime bloke" = road blocked, "pa kapav pase" = cannot pass.
    roots: ['bloke', 'bloque', 'blocked', 'ferme', 'barre', 'pa kapav pase', 'embouteillage', 'traffic', 'bouchon'],
    weight: 2,
  },
  {
    kind: 'hazard',
    // "trou" = hole, "danze" = danger, "glisan" = slippery, "pann" = broken down.
    roots: ['trou', 'nid de poule', 'pothole', 'danze', 'danger', 'glisan', 'glissant', 'pann', 'panne', 'en panne', 'obstacle', 'brans', 'branche', 'debri'],
    weight: 2,
  },
  {
    kind: 'police',
    roots: ['lapolis', 'police', 'kontrol', 'controle', 'radar', 'barraz', 'barrage'],
    weight: 2,
  },
]

/** Words that only matter next to something else, so they never decide a
 *  kind on their own but do raise confidence when they turn up. */
const SUPPORT = ['sime', 'chemin', 'lor', 'sur', 'rond point', 'rondpoint', 'roundabout', 'lari', 'route', 'motorway', 'lotoroute']

/** Flatten for matching: lowercase, strip accents and punctuation, squeeze
 *  spaces. A recogniser's apostrophes and hyphens are not signal. */
export function flatten(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The towns named in the sentence, in the order they were said. */
function placesIn(flat: string, places: Place[]): Place[] {
  const hits: { place: Place; at: number }[] = []
  for (const p of places) {
    const at = flat.indexOf(flatten(p.name))
    if (at >= 0) hits.push({ place: p, at })
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.place)
}

/**
 * What the app thinks it heard, or null.
 *
 * Null is a real answer and the common one for anything off-topic. The
 * caller shows the transcript and lets the rider pick by hand, which is
 * both the honest fallback and the one that still works in a noisy room.
 */
export function hearHazard(transcript: string, places: Place[]): HeardHazard | null {
  const flat = flatten(transcript)
  if (!flat) return null

  let best: { kind: HazardKind; matched: string[]; score: number } | null = null
  for (const entry of LEXICON) {
    const matched = entry.roots.filter((r) => flat.includes(r))
    if (matched.length === 0) continue
    const score = matched.length * entry.weight
    if (!best || score > best.score) best = { kind: entry.kind, matched, score }
  }
  if (!best) return null

  const support = SUPPORT.filter((w) => flat.includes(w))
  const place = placesIn(flat, places)[0] ?? null

  // Two independent signals before calling it sure: either the hazard word
  // appeared more than once in different forms, or a road word or a place
  // name backed it up. One fragment of one word is how you get a flood pin
  // from someone saying "delicious".
  const sure = best.matched.length > 1 || support.length > 0 || place !== null

  return {
    kind: best.kind,
    matched: [...best.matched, ...support],
    place,
    confidence: sure ? 'sure' : 'unsure',
    // The rider's own sentence, trimmed to the note length the route takes.
    note: transcript.trim().slice(0, 140),
  }
}

/** Plain-language label for a kind, for the confirmation screen. */
export const KIND_LABEL: Record<HazardKind, string> = {
  crash: 'Crash',
  blocked: 'Road blocked',
  flood: 'Flooding',
  hazard: 'Hazard on the road',
  police: 'Police check',
}

/** Examples shown on the screen, so a rider knows what it can hear. These
 *  are the phrases the lexicon above was built from. */
export const EXAMPLE_PHRASES = [
  'Delo lor sime rond-point Caudan',
  'Loto fine tape Montebello',
  'Trou dan sime Trianon',
  'Sime bloke apre Quatre Bornes',
  'Lapolis pe kontrole Curepipe',
]
