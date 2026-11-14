/**
 * Deciding that someone is calling for help.
 *
 * Two independent triggers, because the one that is pleasant to demonstrate
 * and the one that will actually work are not the same trigger.
 *
 * The first is the words. A phrase table, not a model: English, French and
 * Kreol, matched on roots against whatever the recogniser produced. Kreol is
 * French-lexified and no phone ships a Morisyen model, so the recogniser is
 * asked for French and "oskour" comes back as something near "au secours".
 * Matching on roots rather than whole words is what makes that survivable.
 *
 * The second is loudness alone. No language, no model, no signal — just the
 * microphone, read directly. A person pinned under a bike is not enunciating,
 * and in the place this app is for there is frequently no data connection at
 * all. The shout trigger is the one that is always there.
 *
 * Neither trigger dials anything. Both open a spoken countdown the rider can
 * stop with a word, because the alternative is an ambulance sent to a lorry's
 * air horn. A false alarm costs a real crew a real call-out, so the cost of
 * being wrong is carried here, in a cancellable delay, rather than by the
 * health service.
 *
 * WHICH WAY THE DOUBT FALLS. Distress beats cancel when a sentence contains
 * both, and that is the opposite of what this file did at first. The old rule
 * reasoned that a rider who is fine but ignored can still press the button —
 * but the entire premise of this feature is a rider who cannot reach the
 * button. For them a wrongly-heard cancel is fatal and a wrongly-heard
 * distress is an apology. "Help, I can't stop the bleeding" has to escalate.
 */

/**
 * Flatten for matching.
 *
 * Apostrophes are deleted rather than turned into spaces. Replacing them left
 * "I can't move" as "i can t move", which matches no root in the table — so
 * two of the plainest sentences an English-speaking rider could say, "I can't
 * move" and "I'm hurt", were silently unmatchable. Everything else that is
 * not a letter or a digit becomes a space.
 */
export function flatten(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Roots that mean "I need help now", in the three languages actually spoken
 *  on a Mauritian roadside. */
const DISTRESS = [
  // English
  'help', 'emergency', 'ambulance', 'i am hurt', 'im hurt', 'cant move', 'cannot move',
  'im bleeding', 'bleeding', 'im stuck', 'im trapped', 'cant breathe',
  // French, which is also what the recogniser hears Kreol as
  'au secours', 'ausecours', 'secours', 'aidez', 'a laide', 'urgence',
  'je suis blesse', 'peux pas bouger', 'coince',
  // Kreol, as French-model output tends to render it
  'oskour', 'oskor', 'o sekour', 'sekour', 'ed mwa', 'aide moi', 'aid mwa',
  'mo blese', 'mo bles', 'mo pa kapav bouze', 'pa kapav bouze', 'sove mwa',
  'mo bondie', 'mo bondye', 'mo bon dieu', 'ayo',
]

/**
 * Roots that mean "I am fine, stop".
 *
 * Every entry here is at least two words. That is a rule, not a coincidence.
 * A single short token is a substring of ordinary speech — "stop" sits inside
 * "I can't stop the bleeding", and "mo bon" sits inside "mo Bondie", which is
 * the commonest thing a hurt Mauritian says. Both of those read as the exact
 * opposite of what the speaker meant. Bare tokens are handled separately
 * below, where they are required to be the whole utterance.
 */
const CANCEL = [
  'i am fine', 'im fine', 'im ok', 'i am ok', 'im alright', 'i am alright',
  'ca va bien', 'tout va bien', 'mo korek', 'tout korek', 'mo bien',
  'no help', 'dont need help', 'pa bizin', 'pas besoin', 'false alarm',
  'everything is fine', 'im not hurt', 'nothing happened',
]
// A bare "ça va" is deliberately absent. "Ça va pas" — I am not all right —
// contains it, so the worst thing a rider could say would have been read as
// the best. Every phrase above was checked for the same trap in both
// directions: none survives a negator in front, and none is a prefix of a
// longer word that means something else.

/**
 * Short words that cancel only when they are the whole sentence.
 *
 * "Stop" on its own is unambiguous. "Stop" inside "I can't stop the bleeding"
 * is the opposite, and no amount of word-boundary matching separates the two,
 * because both contain the word. So these are compared against the entire
 * utterance rather than searched for inside it.
 */
const CANCEL_ALONE = [
  'stop', 'cancel', 'annule', 'annuler', 'arrete', 'arretez', 'arret', 'aret',
  'arete', 'non', 'no', 'ok', 'okay', 'korek', 'bien',
]

/**
 * Phrases that turn a cry for help into its refusal.
 *
 * "I don't need help" contains "help". Without this it escalated, which is
 * both wrong and the kind of wrong that teaches a rider to switch the feature
 * off.
 */
const NEGATED_DISTRESS = [
  'dont need help', 'do not need help', 'no help needed', 'nobody needs help',
  'pa bizin led', 'pa bizin ed', 'pas besoin daide', 'pas besoin de aide',
  'no ambulance', 'pas dambulance', 'dont call', 'do not call', 'pa apel',
]

export type Heard = 'distress' | 'cancel' | null

/** Whole-utterance equality for the bare tokens, allowing a trailing stem so
 *  a recogniser writing "arretez" still matches the root "arrete". */
function isCancelAlone(flat: string): boolean {
  const words = flat.split(' ').filter(Boolean)
  if (words.length === 0 || words.length > 3) return false
  // Every word must itself be a cancel token, so "stop stop" and "no, ok"
  // cancel while "stop the bleeding" cannot.
  return words.every((w) => CANCEL_ALONE.some((c) => w === c || w.startsWith(c)))
}

/**
 * What a transcript means, or nothing.
 *
 * Distress is tested first and wins. See the note at the top of this file:
 * the rider this exists for cannot reach the button, so a wrongly-heard
 * cancel is the one error with no way back.
 */
export function hearSos(transcript: string): Heard {
  const flat = flatten(transcript)
  if (!flat) return null

  const refused = NEGATED_DISTRESS.some((w) => flat.includes(w))
  if (!refused && DISTRESS.some((w) => flat.includes(w))) return 'distress'

  if (refused) return 'cancel'
  if (CANCEL.some((w) => flat.includes(w))) return 'cancel'
  if (isCancelAlone(flat)) return 'cancel'
  return null
}

/** The matched root, for showing the rider why the phone reacted. Searched in
 *  the same order the verdict was reached, so the word shown is the word that
 *  actually decided it. */
export function matchedWord(transcript: string): string | null {
  const flat = flatten(transcript)
  if (!flat) return null
  const refused = NEGATED_DISTRESS.find((w) => flat.includes(w))
  if (!refused) {
    const d = DISTRESS.find((w) => flat.includes(w))
    if (d) return d
  }
  if (refused) return refused
  return CANCEL.find((w) => flat.includes(w)) ?? (isCancelAlone(flat) ? flat : null)
}

/** Shown on screen so a rider knows what the phone is listening for. Every
 *  one of these is checked by the tests to do what the screen claims. */
export const SOS_PHRASES = ['Help', 'Au secours', 'Oskour', 'Ambulance']
export const CANCEL_PHRASES = ['Stop', 'Mo korek', 'I am fine']

// ------------------------------------------------------------------- shouting

/**
 * A sustained shout, against whatever the background happens to be.
 *
 * An absolute threshold is useless here. The background on a Mauritian road
 * is a running engine, wind and traffic; the background in a demo room is
 * near silence. So this tracks a slow baseline and fires on the gap above it,
 * the same shape the pothole detector uses on the accelerometer, for the same
 * reason: what matters is the departure, not the number.
 */
export class ShoutDetector {
  /** How far above the quiet baseline counts as shouting. Both level sources
   *  are scaled to put a real shout comfortably past this; the screen shows
   *  the largest gap actually seen, so it can be checked on a real phone in
   *  a few seconds rather than argued about. */
  static readonly MARGIN = 3.0

  /** How long it must stay up. Long enough to rule out a horn, a door slam
   *  or a single bark; short enough that one cry for help is enough. */
  static readonly SUSTAIN_MS = 1200

  /** Samples older than this are forgotten, so a shout must be continuous
   *  rather than accumulated over a noisy minute. */
  static readonly WINDOW_MS = 2500

  /** The gap must be filled, not merely spanned. Two bangs 1.2 seconds apart
   *  used to satisfy the span test between them with nothing in between,
   *  which is a car door closing twice, not a person shouting. */
  static readonly MIN_SAMPLES = 8

  private baseline: number | null = null
  private loud: { at: number; level: number }[] = []
  /** The first few readings, used to seed the baseline from the quietest of
   *  them. Seeding from a single first sample meant that arming the
   *  microphone while someone was already shouting made the shout the
   *  definition of quiet, and it could then never be heard. */
  private seed: number[] = []
  /** The largest gap above the background seen since arming. Calibration
   *  only: nobody can read a live meter while they are shouting. */
  private peak = 0
  /** Null means never fired. It cannot be zero: zero is a real timestamp as
   *  far as the guard below is concerned. */
  private firedAt: number | null = null

  get quietLevel(): number | null {
    return this.baseline
  }

  get peakOver(): number {
    return this.peak
  }

  reset(): void {
    this.baseline = null
    this.loud = []
    this.seed = []
    this.peak = 0
    this.firedAt = null
  }

  /**
   * Feed one reading. Returns true exactly once per shout.
   *
   * `now` is passed in rather than read, so the behaviour is testable without
   * waiting two and a half real seconds per case.
   */
  push(level: number, now: number): boolean {
    // Settle on a baseline from the quietest of the first few readings, so
    // arming mid-shout does not make the shout the new normal.
    if (this.seed.length < 5) {
      this.seed.push(level)
      this.baseline = Math.min(...this.seed)
      return false
    }
    if (this.baseline === null) this.baseline = level

    const over = level - this.baseline
    if (over > this.peak) this.peak = over
    const shouting = over >= ShoutDetector.MARGIN

    if (shouting) {
      this.loud.push({ at: now, level })
      // The baseline is frozen while someone is shouting. Letting it follow
      // meant a long cry for help slowly became the new definition of quiet
      // and the detector disarmed itself partway through.
    } else {
      // Settle toward quiet quickly, drift upward slowly. A lull should be
      // adopted as the new background at once, while a passing lorry should
      // barely move it.
      const alpha = level > this.baseline ? 0.04 : 0.15
      this.baseline = this.baseline + alpha * (level - this.baseline)
    }

    this.loud = this.loud.filter((s) => now - s.at <= ShoutDetector.WINDOW_MS)

    if (this.loud.length < ShoutDetector.MIN_SAMPLES) return false

    const span = now - this.loud[0].at
    if (span < ShoutDetector.SUSTAIN_MS) return false

    // One shout, one trigger. Without this the same cry fires on every
    // reading for as long as it lasts.
    if (this.firedAt !== null && now - this.firedAt < ShoutDetector.WINDOW_MS * 2) {
      return false
    }
    this.firedAt = now
    this.loud = []
    return true
  }
}
