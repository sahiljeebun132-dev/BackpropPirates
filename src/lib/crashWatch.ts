/** Crash watch: notice a heavy impact, then make getting help one tap.
 *
 * What a web app can genuinely do, and what it cannot, decided this design.
 *
 *   It can   read the accelerometer, hold the screen awake, record audio,
 *            take a GPS fix, and prepare a call or a message.
 *   It cannot place a call, or send a message, on its own. Browsers forbid
 *            both, deliberately, and no permission unlocks them. A page that
 *            could dial silently would be a gift to every scam site.
 *
 * So detection is automatic and everything that leaves the phone is one tap,
 * on a screen built so that tap is the only thing to do. The app says this
 * plainly rather than letting someone believe help is already on its way.
 *
 * It also only works while the app is open and the screen is on, because a
 * background tab is throttled or suspended. A phone face-down in a pocket is
 * not being watched. That limit is stated where the feature is armed.
 */

import { getFix } from './position'

/** Peak acceleration that counts as an impact, in m/s².
 *
 * Still, a phone reads about 9.8 (gravity alone). Ordinary driving, including
 * hard braking and potholes, stays well under 20. A collision is in the
 * hundreds. The bar sits at 30 so a firm shake also triggers it, which is both
 * how you demo the feature and how someone checks it works before relying on
 * it. The countdown exists precisely because this will sometimes be wrong.
 */
export const IMPACT_THRESHOLD_MS2 = 30

/** Test mode's bar, in m/s². A hand shake peaks somewhere around 2g to 3g and
 *  a phone only samples about 60 times a second, so it can miss the top of a
 *  real spike. 16 is low enough that a deliberate shake always fires and high
 *  enough that carrying the phone does not. Test mode is never left on by
 *  accident: the screen says so in red the whole time it is active. */
export const TEST_THRESHOLD_MS2 = 16

/** Seconds to cancel before the app decides you cannot answer. */
export const COUNTDOWN_SECONDS = 30

/** Recording stops here. Long enough to matter, short enough to share. */
export const MAX_RECORDING_SECONDS = 45

export type EmergencyContact = { id: string; name: string; phone: string }

const CONTACTS_KEY = 'zetway.contacts'

export function readContacts(): EmergencyContact[] {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as EmergencyContact[]).slice(0, 3) : []
  } catch {
    return []
  }
}

export function writeContacts(contacts: EmergencyContact[]): void {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts.slice(0, 3)))
  } catch {
    // Saving contacts is a convenience. The feature still works without it.
  }
}

/** iOS will not deliver motion events until the user has agreed, and only
 *  then if asked from inside a tap. */
export async function requestMotionPermission(): Promise<boolean> {
  const api = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }
  if (typeof api?.requestPermission !== 'function') return true // Android and desktop
  try {
    return (await api.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Watch for an impact, and report what the sensor is reading as it goes.
 *
 *  The live reading matters more than it looks. Without it, a rider who
 *  shakes the phone and sees nothing cannot tell whether the sensor is
 *  blocked, the app is not listening, or they simply did not shake hard
 *  enough. With it, the number moves and the answer is obvious.
 *
 *  Returns a function that stops watching.
 */
export function watchForImpact(
  onImpact: (peak: number) => void,
  threshold: number = IMPACT_THRESHOLD_MS2,
  onReading?: (magnitude: number) => void,
): () => void {
  let armed = true
  let lastReport = 0

  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity
    if (!a || a.x === null || a.y === null || a.z === null) return
    const magnitude = Math.hypot(a.x, a.y, a.z)

    // Throttled, because the sensor fires about sixty times a second and
    // re-rendering at that rate would do nothing but drain the battery.
    const now = Date.now()
    if (onReading && now - lastReport > 120) {
      lastReport = now
      onReading(magnitude)
    }

    if (armed && magnitude >= threshold) {
      // One trigger per watch. Re-arming is the caller's decision, after the
      // rider has dealt with the alert.
      armed = false
      onImpact(Math.round(magnitude))
    }
  }

  window.addEventListener('devicemotion', handler)
  return () => {
    armed = false
    window.removeEventListener('devicemotion', handler)
  }
}

/** Whether this phone lets a web page vibrate at all.
 *
 *  iPhones do not, in any browser: Safari has never shipped the Vibration
 *  API, and every iOS browser is Safari underneath. Rather than silently do
 *  nothing there, the app says so and leans on sound instead.
 */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

export function buzz(pattern: number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Some browsers expose it and refuse it. Not worth a failure.
  }
}

/** A loud two-tone alarm, built with Web Audio so it needs no audio file.
 *
 *  Sound carries where vibration cannot: it works on an iPhone, it reaches
 *  someone who has dropped the phone, and it tells a passer-by something is
 *  wrong. The context is created when the watch is armed, because a browser
 *  will not let a page make noise until the user has interacted with it.
 */
export function createAlarm(): { start: () => void; stop: () => void } | null {
  type WindowWithAudio = Window & { webkitAudioContext?: typeof AudioContext }
  const Ctor = window.AudioContext ?? (window as WindowWithAudio).webkitAudioContext
  if (!Ctor) return null

  let ctx: AudioContext | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const beep = (at: number, frequency: number) => {
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = frequency
    // Ramped rather than switched, because an abrupt square wave clicks.
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.38)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + 0.4)
  }

  return {
    start: () => {
      try {
        ctx ??= new Ctor()
        void ctx.resume()
        const cycle = () => {
          if (!ctx) return
          beep(ctx.currentTime, 880)
          beep(ctx.currentTime + 0.45, 660)
        }
        cycle()
        timer ??= setInterval(cycle, 1000)
      } catch {
        // No sound is survivable. The screen still shouts.
      }
    },
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
      void ctx?.close()
      ctx = null
    },
  }
}

/** Keep the screen on. Without this the phone sleeps, the page is suspended
 *  and nothing is being watched at all. */
export async function keepAwake(): Promise<{ release: () => void } | null> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
  }
  if (!nav.wakeLock) return null
  try {
    const sentinel = await nav.wakeLock.request('screen')
    return { release: () => void sentinel.release().catch(() => {}) }
  } catch {
    return null
  }
}

export type Recording = { blob: Blob; url: string; seconds: number }

/** Record ambient audio after an impact.
 *
 * Started only once the countdown has run out, with a banner on screen saying
 * it is recording. Passengers and bystanders have not agreed to anything, so
 * it does not run quietly in the background while someone drives.
 */
export async function recordAudio(
  onFinish: (rec: Recording) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  let stop = () => {}
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream)
    const startedAt = Date.now()

    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      onFinish({
        blob,
        url: URL.createObjectURL(blob),
        seconds: Math.round((Date.now() - startedAt) / 1000),
      })
    }
    recorder.start()
    const timer = setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
    }, MAX_RECORDING_SECONDS * 1000)

    stop = () => {
      clearTimeout(timer)
      if (recorder.state !== 'inactive') recorder.stop()
    }
  } catch {
    onError('Microphone unavailable, so there is no recording. Everything else still works.')
  }
  return () => stop()
}

/** A single fix, taken the moment an impact is detected.
 *
 *  Delegated so the Android build uses the native location API, which asks for
 *  the permission properly and fails fast where a web view would hang. */
export function currentPosition(): Promise<{ lat: number; lon: number; accuracy: number } | null> {
  return getFix({ timeoutMs: 10_000, maxAgeMs: 30_000 })
}

/** The message a contact receives. Location first: if they read nothing else,
 *  they need to know where. */
export function helpMessage(
  position: { lat: number; lon: number } | null,
  peak: number | null,
): string {
  const where = position
    ? `https://www.google.com/maps?q=${position.lat.toFixed(5)},${position.lon.toFixed(5)}`
    : 'Location unavailable, I will try to send it separately.'
  const impact = peak ? ` Zetway detected an impact of about ${(peak / 9.8).toFixed(1)}g.` : ''
  return `I may have had a road accident and did not respond on my phone.${impact} My location: ${where}`
}

export const smsLink = (phone: string, body: string): string =>
  `sms:${phone.replace(/\s+/g, '')}?&body=${encodeURIComponent(body)}`

export const whatsappLink = (phone: string, body: string): string =>
  `https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(body)}`
