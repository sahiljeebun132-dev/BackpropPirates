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
 * microphone's own metering, which arrives on the same stream as the words.
 * A person pinned under a bike is not enunciating, and in the place this app
 * is for there is frequently no data connection at all. The shout trigger is
 * the one that is always there.
 *
 * Neither trigger dials anything. Both open a spoken countdown the rider can
 * stop with a word, because the alternative is an ambulance sent to a lorry's
 * air horn. A false alarm costs a real crew a real call-out, so the cost of
 * being wrong is carried here, in a cancellable delay, rather than by the
 * health service.
 */

/** Flatten for matching: lowercase, strip accents and punctuation. A
 *  recogniser's apostrophes and hyphens are not signal. */
export function flatten(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Roots that mean "I need help now", in the three languages actually spoken
 *  on a Mauritian roadside. Matched as substrings, so inflections and the
 *  recogniser's own spelling inventions still land. */
const DISTRESS = [
  // English
  'help', 'emergency', 'ambulance', 'i am hurt', 'im hurt', 'cant move', 'cannot move',
  // French, which is also what the recogniser hears Kreol as
  'au secours', 'ausecours', 'secours', 'aidez', 'a l aide', 'urgence', 'ambulance',
  'je suis blesse', 'peux pas bouger',
  // Kreol, as French-model output tends to render it
  'oskour', 'oskor', 'o sekour', 'sekour', 'ed mwa', 'aide moi', 'aid mwa',
  'mo blese', 'mo bles', 'mo pa kapav bouze', 'pa kapav bouze', 'sove mwa',
]

/** Roots that mean "I am fine, stop". Deliberately short and distinct from
 *  anything in the distress list: this is the word a rider says while
 *  standing up from a dropped bike, and it must never be misheard as the
 *  opposite. */
const CANCEL = [
  'stop', 'cancel', 'annule', 'annuler', 'arrete', 'arret', 'aret', 'aret sa',
  'i am fine', 'im fine', 'im ok', 'i am ok', 'ca va bien', 'mo korek', 'mo bon',
  'tout korek', 'pa bizin', 'no help', 'false alarm',
]
// A bare "ça va" is deliberately absent. "Ça va pas" — I am not all right —
// contains it, so a rider saying the worst thing they could say would have
// been heard as the best, and the countdown they needed would have stopped.
// Every phrase above was checked for the same trap: none of them survives
// having "pa" or "not" put in front of it.

export type Heard = 'distress' | 'cancel' | null

/**
 * What a transcript means, or nothing.
 *
 * Cancel is checked first and wins outright. If a sentence somehow contains
 * both, the rider saying they are fine is the reading that cannot hurt
 * anyone: the worst case is a countdown stopped by someone who then presses
 * the button themselves, against an ambulance sent to someone who said no.
 */
export function hearSos(transcript: string): Heard {
  const flat = flatten(transcript)
  if (!flat) return null
  if (CANCEL.some((w) => flat.includes(w))) return 'cancel'
  if (DISTRESS.some((w) => flat.includes(w))) return 'distress'
  return null
}

/** The matched root, for showing the rider why the phone reacted. */
export function matchedWord(transcript: string): string | null {
  const flat = flatten(transcript)
  return (
    CANCEL.find((w) => flat.includes(w)) ?? DISTRESS.find((w) => flat.includes(w)) ?? null
  )
}

/** Shown on screen so a rider knows what the phone is listening for. */
export const SOS_PHRASES = ['Help', 'Au secours', 'Oskour', 'Ambulance']
export const CANCEL_PHRASES = ['Stop', 'Mo korek', 'Ça va']

// ------------------------------------------------------------------- shouting

/**
 * A sustained shout, against whatever the background happens to be.
 *
 * An absolute threshold is useless here. The background on a Mauritian road
 * is a running engine, wind and traffic; the background in a demo room is
 * near silence. So this tracks a slow baseline and fires on the gap above it,
 * the same shape the pothole detector uses on the accelerometer, for the same
 * reason: what matters is the departure, not the number.
 *
 * The baseline only moves upward quickly and downward slowly, so a long shout
 * cannot quietly become the new normal and disarm the trigger mid-cry.
 */
export class ShoutDetector {
  /** How far above the quiet baseline counts as shouting. Android reports
   *  roughly 0–10 from this callback, so three is a large, deliberate gap —
   *  speaking normally does not clear it. */
  static readonly MARGIN = 3.0

  /** How long it must stay up. Long enough to rule out a horn, a door slam
   *  or a single bark; short enough that one cry for help is enough. */
  static readonly SUSTAIN_MS = 1200

  /** Samples older than this are forgotten, so a shout must be continuous
   *  rather than accumulated over a noisy minute. */
  static readonly WINDOW_MS = 2500

  private baseline: number | null = null
  private loud: { at: number; level: number }[] = []
  /** The largest gap above the background seen since arming.
   *
   *  This is here for calibration rather than for detection. MARGIN below is
   *  the one constant in this feature that has never been measured against a
   *  real microphone — the emulator has no audio hardware — and nobody can
   *  read a live meter while they are shouting. Keeping the peak means a
   *  tester can shout, stop, and then read what their shout was actually
   *  worth. */
  private peak = 0
  /** Null means never fired. It cannot be zero: zero is a real timestamp as
   *  far as the guard below is concerned, and treating "never" as "fired at
   *  the first instant" left the shout trigger dead for the first five
   *  seconds of every session — exactly the five seconds after a crash. */
  private firedAt: number | null = null

  /** Current baseline, for the meter on screen. Null until the first sample. */
  get quietLevel(): number | null {
    return this.baseline
  }

  /** Loudest gap above the background since arming. Compare against MARGIN:
   *  below it, no shout will ever fire on this phone in this room. */
  get peakOver(): number {
    return this.peak
  }

  reset(): void {
    this.baseline = null
    this.loud = []
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
    if (this.baseline === null) {
      this.baseline = level
      return false
    }

    const over = level - this.baseline
    if (over > this.peak) this.peak = over
    const shouting = over >= ShoutDetector.MARGIN

    if (shouting) {
      this.loud.push({ at: now, level })
      // The baseline is frozen while someone is shouting. Letting it follow
      // meant a long cry for help slowly became the new definition of quiet
      // and the detector disarmed itself partway through — measured at 7.7
      // out of 10 after eight seconds, by which point nothing could clear
      // the margin any more. The baseline tracks the background, and a
      // person shouting is not the background.
    } else {
      // Settle toward quiet quickly, drift upward slowly. A lull should be
      // adopted as the new background at once, while a passing lorry should
      // barely move it.
      const alpha = level > this.baseline ? 0.04 : 0.15
      this.baseline = this.baseline + alpha * (level - this.baseline)
    }

    this.loud = this.loud.filter((s) => now - s.at <= ShoutDetector.WINDOW_MS)

    if (this.loud.length < 2) return false

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
