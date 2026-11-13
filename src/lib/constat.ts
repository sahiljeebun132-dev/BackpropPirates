/** The four photographs to take after a collision, and the note that goes
 *  with them.
 *
 * After a collision here both drivers fill in one paper constat amiable
 * together and both sign it. It is a shared statement of the facts — where
 * the vehicles ended up, what touched what, who was there. Signing it is not
 * an admission of fault and it is not a claim, and nothing in this app files
 * anything on anyone's behalf.
 *
 * The photographs that would settle an argument months later are the ones
 * nobody thinks to take in the first five minutes, because the first instinct
 * is to clear the road and once the cars have moved the positions are gone
 * for good. Hence a short list, in the order that matters, each with the
 * reason attached: someone shaken will do a thing they understand the point
 * of and skip a thing they do not.
 *
 * None of it replaces the form. The pictures are evidence of what the form
 * describes, and they only help if the form is filled in too.
 */

export type ConstatShotId = 'plates' | 'scene' | 'impact' | 'vignette'

export type ConstatShot = {
  id: ConstatShotId
  label: string
  /** Why this one is worth taking, in one line. */
  why: string
  /** Where to stand and what has to be in the frame. */
  how: string
}

export const CONSTAT_SHOTS: ConstatShot[] = [
  {
    id: 'plates',
    label: 'Both number plates in one frame',
    why: 'Proves which two vehicles were in this, before either one moves.',
    how: 'Stand back far enough that both plates are readable in the same picture. Two separate photos of two plates say nothing about the two being here together.',
  },
  {
    id: 'scene',
    label: 'The wider scene, with the road markings',
    why: 'Shows where each vehicle stopped and which lane it was in.',
    how: 'Back along the road, far enough to get the centre line, the kerb and both vehicles in one frame.',
  },
  {
    id: 'impact',
    label: 'Close on the impact zone',
    why: 'The damage is what gets argued over, and it reads differently once the cars are apart.',
    how: 'Close enough to see which panels met, wide enough to still tell which vehicle it is.',
  },
  {
    id: 'vignette',
    label: 'Their insurance vignette or licence disk',
    why: 'It carries the insurer and the dates it covers — what the form asks you for.',
    how: 'The sticker on their windscreen. Check the photo is readable before you walk away from the car.',
  },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pad = (n: number): string => String(n).padStart(2, '0')

/* Written out by hand rather than through Intl. This text gets pasted into a
 * message and read weeks later by an insurer or the other driver, so it needs
 * to say the same thing whatever locale the handset happens to be set to. */
const dayOf = (d: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
const timeOf = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * The plain-text note the rider copies out: which shots exist, when each was
 * taken, and where the phone was.
 *
 * Deliberately says what is missing as well as what was taken. A list that
 * only shows four ticks when two photographs exist is worse than no list.
 */
export function constatSummary(
  taken: { id: ConstatShotId; at: Date }[],
  position: { lat: number; lon: number } | null,
  now: Date,
): string {
  const labels = new Map(CONSTAT_SHOTS.map((s) => [s.id, s.label]))
  const lines = [`Constat photographs — ${dayOf(taken[0]?.at ?? now)}`, '']

  if (taken.length > 0) {
    lines.push('Taken on this phone:')
    for (const t of taken) lines.push(`- ${timeOf(t.at)}  ${labels.get(t.id) ?? t.id}`)
  } else {
    lines.push('No photographs taken yet.')
  }

  const missing = CONSTAT_SHOTS.filter((s) => !taken.some((t) => t.id === s.id))
  if (missing.length > 0) {
    lines.push('', 'Not taken:')
    for (const m of missing) lines.push(`- ${m.label}`)
  }

  lines.push(
    '',
    position
      ? `Phone location: ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`
      : 'No location fix on this phone.',
    '',
    'The photographs are on this phone and have not been sent anywhere. They go with the constat both drivers fill in and sign — they do not replace it.',
  )

  return lines.join('\n')
}
