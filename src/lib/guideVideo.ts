/**
 * "Show me a video of this."
 *
 * The guides are written text, and that is deliberate: they have to work in
 * airplane mode, in the dark, at the side of a road, on a phone with one bar.
 * A bundled video would have broken all four — the whole app is 269 KB of
 * data plus the bundle, and one minute of usable video is several times that.
 *
 * But "read these nine steps" is not what a frightened person wants when they
 * have never changed a wheel, and pretending otherwise was the gap. So each
 * guide carries a search that opens YouTube at the specific job. It is a link
 * out, not our content, and the app says so rather than dressing someone
 * else's video up as a feature.
 *
 * A search rather than one chosen video id, for two reasons. A single video
 * can be deleted or made private and the button then goes to a dead page,
 * which is worse than no button. And we have not watched every candidate, so
 * naming one would be vouching for advice we have not checked — on a page
 * whose entire argument is that it only states what it can source.
 *
 * The queries are written for a rider in Mauritius: right-hand drive, metric,
 * and the vehicle named the way the guide names it.
 */

const QUERY: Record<string, string> = {
  // Cars
  'flat-tyre': 'how to change a car wheel spare tyre step by step',
  'wont-start': 'car will not start clicking jump start safely',
  overheating: 'car overheating what to do coolant top up safely',
  'warning-light': 'car dashboard warning lights explained',
  'oil-check': 'how to check engine oil dipstick correctly',
  'out-of-fuel': 'ran out of fuel car what to do restart diesel',
  'smoke-or-smell': 'car smoke burning smell engine bay what to do',

  // Motorcycles
  'moto-puncture': 'motorcycle puncture repair roadside plug kit',
  'moto-wont-start': 'motorcycle will not start troubleshooting roadside',
  'moto-chain': 'motorcycle chain came off how to refit and tension',
  'moto-dropped': 'motorcycle dropped low side what to check before riding',
  'moto-lights': 'motorcycle lights not working fuse check roadside',
  'moto-overheating': 'motorcycle overheating what to do coolant',
  'moto-out-of-fuel': 'motorcycle out of fuel reserve petcock what to do',
  'moto-fire': 'motorcycle fuel smell leak what to do safety',
}

/** Where the "watch how" button goes, or null for guides where watching a
 *  stranger's video is the wrong advice. */
export function videoSearchUrl(guideId: string): string | null {
  const q = QUERY[guideId]
  if (!q) return null
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}

/** Guides where the answer is to get away from the vehicle, not to watch
 *  something. Offering a tutorial here would be actively dangerous. */
export const NO_VIDEO = new Set(['smoke-or-smell', 'moto-fire'])

export function hasVideo(guideId: string): boolean {
  return !NO_VIDEO.has(guideId) && videoSearchUrl(guideId) !== null
}
