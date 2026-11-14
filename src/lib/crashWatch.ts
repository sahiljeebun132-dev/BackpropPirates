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
 * On the web it also only works while the page is open and the screen is on,
 * because a background tab is throttled or suspended. A phone face-down in a
 * pocket is not being watched. That limit is stated where the feature is
 * armed.
 *
 * The Android build does not have that limit: CrashWatchService holds the
 * sensor and a partial wake lock in a foreground service, so watching
 * survives the screen going off and the app being closed. In that build the
 * service is the only detector, and the listener here feeds the on-screen
 * meter alone — see startWatching in CrashWatch.tsx.
 */

import { medicalSummary, readMedicalId } from './medicalId'
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
 *  they need to know where.
 *
 *  This is the single place the outgoing text is built — the alert screen and
 *  the automatic escalation both call it — so it is the single place the
 *  medical summary is attached.
 */
/** Where the alert page lives. Absolute on purpose: inside the APK the
 *  page origin is https://localhost, and a link to that in somebody else's
 *  text message goes nowhere. */
const ALERT_ORIGIN = 'https://backprop-pirates.vercel.app'

export function helpMessage(
  position: { lat: number; lon: number } | null,
  peak: number | null,
): string {
  const where = position
    ? `https://www.google.com/maps?q=${position.lat.toFixed(5)},${position.lon.toFixed(5)}`
    : 'Location unavailable, I will try to send it separately.'
  const impact = peak ? ` Zetway detected an impact of about ${(peak / 9.8).toFixed(1)}g.` : ''

  // A second link, and the reason it is worth the characters: a map pin is
  // silent. A text arrives while the phone is in a pocket and waits to be
  // read, which is the wrong behaviour for the one message that must not
  // wait. This link opens a page that sounds an alarm, shows the position
  // and puts 114 one tap away.
  //
  // It works on an iPhone, which matters more here than anywhere else in
  // this app: iOS has no vibration API and will not run a background sensor
  // for a web page, so an iPhone cannot be the phone that detects the crash
  // — but it can absolutely be the phone that is woken by one, and most of
  // the people a rider lists are not on Android.
  //
  // Everything the page needs is in the URL. No account, no lookup, nothing
  // to go down: the link works as long as the site serves a static file.
  const alert = position
    ? ` Alarm and details: ${ALERT_ORIGIN}/alert.html?lat=${position.lat.toFixed(5)}&lon=${position.lon.toFixed(5)}${
        peak ? `&g=${(peak / 9.8).toFixed(1)}` : ''
      }&t=${Date.now()}`
    : ''

  const core = `I may have had a road accident and did not respond on my phone.${impact} My location: ${where}${alert}`

  // The medical summary goes last, never first. Whoever reads this needs
  // where before who: a friend is deciding where to drive and a dispatcher is
  // deciding where to send an ambulance, and both of those decisions come
  // before anything about blood group or allergies. It is also the part that
  // can be empty or cut short, and a message must not open with a gap.
  //
  // medicalSummary caps itself against the length of the sentence above — see
  // the budget note in medicalId.ts before changing either wording.
  const medical = medicalSummary(readMedicalId())
  return medical ? `${core}\n${medical}` : core
}

export const smsLink = (phone: string, body: string): string =>
  `sms:${phone.replace(/\s+/g, '')}?&body=${encodeURIComponent(body)}`

/**
 * wa.me wants one thing and it is not what people save in their contacts.
 *
 * The number has to be full international with no plus and no spaces.
 * Stripping to digits is not enough: a Mauritian mobile is eight digits and
 * gets saved as "5789 1234", which strips to 57891234 and makes WhatsApp
 * answer "phone number shared via url is invalid" -- on the one screen where
 * nobody is going to debug it. So a local-length number gets the country
 * code, and anything already carrying one is left alone.
 *
 * +230 is assumed for short numbers because this app is for Mauritius and
 * the alternative is guessing from the dialling context, which a crashed
 * phone has no way to do.
 */
const MU = '230'

export function waNumber(phone: string): string {
  const trimmed = phone.trim()
  const intl = trimmed.startsWith('+')
  let digits = trimmed.replace(/[^\d]/g, '')
  if (!intl && digits.startsWith('00')) digits = digits.slice(2)
  else if (!intl && digits.length <= 8) digits = MU + digits
  return digits
}

export const whatsappLink = (phone: string, body: string): string =>
  `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(body)}`

/**
 * The impact, in the words a rider can check against what just happened.
 *
 * These are read out, never acted on. The alert has already fired by the
 * time any of this is on screen, and nothing here can call it off: the app
 * says in its own copy that detection is sometimes wrong and that the
 * countdown is the answer to that, so adding a second opinion that could
 * silence the alarm would quietly undo the promise.
 *
 * What they are good for is the opposite question. A phone that slid into
 * the footwell reads a hard knock with almost no rotation and no change of
 * speed. A vehicle that was doing 60 and is now doing nothing, while the
 * phone spun, reads as the thing the app exists for. A rider holding the
 * red screen can tell those apart in a second; the accelerometer alone
 * cannot.
 *
 * -1 from the service means not measured — this phone has no gyroscope, or
 * location was refused, or no fix had arrived. It is shown as that rather
 * than as a zero somebody could read as "you were already stopped".
 */
export function evidenceLines(
  e: {
    peak: number
    rotation: number
    speedBefore: number
    speedAfter: number
    complete: boolean
  } | null,
): { label: string; value: string }[] {
  if (!e) return []
  const kmh = (ms: number) => `${Math.round(ms * 3.6)} km/h`
  return [
    { label: 'Impact', value: `${(e.peak / 9.8).toFixed(1)}g` },
    {
      label: 'Rotation',
      value: e.rotation < 0 ? 'no gyroscope here' : `${e.rotation.toFixed(1)} rad/s`,
    },
    {
      label: 'Speed before',
      value: e.speedBefore < 0 ? 'not measured' : kmh(e.speedBefore),
    },
    {
      label: 'Speed after',
      value:
        e.speedAfter < 0
          ? e.complete
            ? 'not measured'
            : 'still measuring'
          : kmh(e.speedAfter),
    },
  ]
}
