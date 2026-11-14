/**
 * Teaching the phone what your shout sounds like.
 *
 * The shout trigger compares a reading against a rolling background and fires
 * on the gap. How big that gap needs to be was, until this file existed, a
 * single number picked by argument: three, on a scale that two different
 * audio sources produce differently, on hardware that was never once measured
 * because the emulator it was built against has no microphone at all.
 *
 * That is a bad way to decide whether somebody gets an ambulance. It is also
 * unnecessary, because the phone can simply be asked. Three seconds of the
 * room, three seconds of the rider shouting, and the difference between them
 * is the answer for that phone, that voice and that helmet — no scale
 * conversion, no assumption about what Android reports, nothing to get wrong.
 *
 * The measurement is kept on the device and nothing about it is uploaded. It
 * is two numbers.
 */

const KEY = 'zetway.shout.calibration'

export type Calibration = {
  /** Median level of the quiet room. */
  quiet: number
  /** How loud the shout got above that. */
  gap: number
  /** The margin derived from it, which is what the detector uses. */
  margin: number
  /** When it was taken, so a stale one can be spotted. */
  at: string
}

/** Used when nobody has calibrated. Deliberately on the generous side: a
 *  phone that has never been measured should err toward hearing a shout that
 *  was not quite one, rather than missing one that was. */
export const DEFAULT_MARGIN = 3.0

/** Below this, ordinary speech and door slams start firing it. Above it, a
 *  real cry would have to be a scream. Both ends are refusals to accept a
 *  measurement that would make the feature worse than the default. */
export const MIN_MARGIN = 1.2
export const MAX_MARGIN = 7.0

/**
 * Turn a measured quiet level and a measured shout into a threshold.
 *
 * Fifty-five per cent of the gap, not the whole of it. The calibration shout
 * is someone standing still in a room being asked to shout; the real one is
 * muffled by a helmet, a windscreen or a lungful of broken rib, and it will
 * be quieter. Taking a little over half leaves room for the shout that
 * matters to be worse than the shout that was practised.
 */
export function marginFrom(quiet: number, shout: number): number {
  const gap = Math.max(0, shout - quiet)
  return Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, gap * 0.55))
}

/** The middle reading, which ignores the cough and the chair scrape that a
 *  mean would happily fold into the room's noise floor. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Near the top of the shout rather than the very top, so one clipped sample
 *  does not set a threshold nothing can reach again. */
export function high(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]
}

export function readCalibration(): Calibration | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Calibration
    if (typeof parsed.margin !== 'number' || !Number.isFinite(parsed.margin)) return null
    // A stored value outside the sane band is treated as absent rather than
    // trusted: it came from somewhere, but not from a measurement worth
    // betting on.
    if (parsed.margin < MIN_MARGIN || parsed.margin > MAX_MARGIN) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCalibration(c: Calibration): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    // A calibration that does not survive a reload is a small loss; the
    // default still works.
  }
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear is the outcome wanted anyway.
  }
}

/** The margin in force: the measured one if there is one, the default if not. */
export function activeMargin(): number {
  return readCalibration()?.margin ?? DEFAULT_MARGIN
}
