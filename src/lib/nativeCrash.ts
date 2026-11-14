import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

import { isNative } from './platform'
import {
  startWebVoice, stopWebVoice, webMicAvailable, webRecognitionAvailable,
  webSpeak, webStopSpeaking, webVoiceRunning,
} from './webVoice'

/**
 * The browser's own ears and voice, behind the same four functions.
 *
 * Everything above this line talks to Java. The hands-free screen and its
 * hook do not care which, and they should not: the PWA had none of this
 * feature at all until these were wired up, which on an iPhone meant the
 * whole thing was missing. A browser cannot listen with the screen off and
 * does not pretend to, but it can hear a shout while it is open, and that
 * is the trigger worth having.
 */
const webListeners: {
  heard: ((d: { text: string; partial: boolean }) => void)[]
  level: ((level: number) => void)[]
  config: ((c: { language: string; onDevice: boolean }) => void)[]
  wordsLost: ((reason: string) => void)[]
  stopped: ((reason: string) => void)[]
} = { heard: [], level: [], config: [], wordsLost: [], stopped: [] }

const fanOut = <T,>(list: ((v: T) => void)[], v: T) => list.forEach((f) => f(v))

/** The native half of crash watch.
 *
 * Every function here resolves to a plain "could not" on the web rather than
 * throwing, so the components can call them unconditionally and show the
 * result. The web build then falls back to the one-tap screen it already has,
 * which is a smaller promise honestly kept rather than a larger one broken.
 */

export type SimpleResult = { ok: boolean; message?: string }

export type SmsResult = {
  ok: boolean
  sent?: string[]
  failed?: string[]
  message?: string
}

export type CallResult = {
  ok: boolean
  message?: string
  /** 'emergency-number' is Android's rule, not a fault, and the UI says so. */
  reason?: 'emergency-number' | 'permission-denied' | 'refused'
}

/**
 * One impact and what the phone measured around it.
 *
 * The accelerometer still decides on its own. These other figures are
 * carried so the red screen can show what happened rather than one number:
 * a phone that slid off a seat reads a hard knock with no rotation and no
 * change of speed, and a rider looking at that can tell.
 *
 * -1 everywhere means "not measured" — no gyroscope on this phone, location
 * refused, or no fix yet — and must be shown as that, never as a zero.
 */
export type ImpactEvidence = {
  /** Peak acceleration magnitude, m/s², gravity included. */
  peak: number
  /** Peak angular rate around the impact, rad/s. */
  rotation: number
  /** Speed from the last fix before the spike, m/s. */
  speedBefore: number
  /** Speed once the few seconds after the spike had passed, m/s. */
  speedAfter: number
  /** False while the service is still measuring the seconds after the hit. */
  complete: boolean
}

export type NativeImpact = ImpactEvidence & { test: boolean }

/**
 * One vertical jolt the road scanner logged.
 *
 * Every field is measured. The service throws away any jolt it cannot place
 * with a recent fix, so there is no "position unknown" case to represent
 * here — a point on a road is either where the phone said it was or it does
 * not exist.
 */
export type NativeJolt = {
  /** Peak departure of the vertical axis from rest, in g. */
  peakG: number
  lat: number
  lon: number
  /** Speed at the jolt, m/s, from the location provider. */
  speed: number
  /** Milliseconds since the epoch. */
  at: number
}

export const NOT_MEASURED = -1

/** Whether an alert would actually reach a rider whose phone is locked in a
 *  pocket. Every one of these is the rider's to grant and none can be
 *  assumed. */
export type Readiness = {
  /** Android 13+: without it the alert cannot post at all. */
  notifications: boolean
  /** Without this the automatic text cannot be sent — and it would be asked
   *  for at the moment of the crash, in front of someone who may be unable
   *  to answer a dialog. */
  sms: boolean
  /** Same, for the automatic call to the first contact. */
  phone: boolean
  /** Same, for recording what is happening around the car. */
  microphone: boolean
  /** Same, for the location that is the most useful thing in the message. */
  location: boolean
  /** Android 14+ reserved full-screen intents for calling and alarm apps.
   *  Denied, the alert is downgraded to a heads-up notification, which on a
   *  locked screen means it never shows — the rider has to wake the phone. */
  lockScreen: boolean
  /** Exempt from battery optimisation. Without it many phones kill the
   *  service after a few minutes in a pocket. */
  unrestricted: boolean
  /** Whether the service is running right now. */
  watching: boolean
}

type CrashResponsePlugin = {
  vibrate(options?: { pattern?: number[]; repeat?: boolean }): Promise<SimpleResult>
  vibrationDiagnostics(): Promise<VibrationReport>
  stopVibration(): Promise<SimpleResult>
  sendSms(options: { numbers: string[]; message: string }): Promise<SmsResult>
  placeCall(options: { number: string }): Promise<CallResult>
  startWatching(options: { threshold: number; test: boolean }): Promise<
    SimpleResult & { notifications?: boolean }
  >
  stopWatching(): Promise<SimpleResult>
  isWatching(): Promise<{ running: boolean }>
  consumePendingImpact(): Promise<NativeImpact & { hasImpact: boolean }>
  setRoadScan(options: { enabled: boolean }): Promise<
    SimpleResult & { enabled: boolean; watching: boolean }
  >
  consumePendingJolts(): Promise<{ jolts: NativeJolt[] }>
  checkReadiness(): Promise<Readiness>
  requestPermissions(): Promise<Record<string, string>>
  openLockScreenSettings(): Promise<SimpleResult>
  requestUnrestricted(): Promise<SimpleResult>
  openAppSettings(): Promise<SimpleResult>
  addListener(
    event: 'impact' | 'impactEvidence',
    handler: (data: NativeImpact) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'jolt', handler: (data: NativeJolt) => void): Promise<PluginListenerHandle>
  speak(options: { text: string }): Promise<SimpleResult & { usable?: boolean }>
  stopSpeaking(): Promise<SimpleResult>
  startListening(): Promise<SimpleResult & { onDevice?: boolean }>
  stopListening(): Promise<SimpleResult>
  voiceStatus(): Promise<VoiceStatus>
  addListener(
    event: 'heard',
    handler: (data: { text: string; partial: boolean }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'hearLevel',
    handler: (data: { level: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'hearStopped',
    handler: (data: { reason: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'hearWordsLost',
    handler: (data: { reason: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'hearConfig',
    handler: (data: { language: string; onDevice: boolean }) => void,
  ): Promise<PluginListenerHandle>
}

/** What this particular phone can hear and say.
 *
 * Every field is asked of the operating system rather than assumed, because
 * the answers genuinely differ: a phone with no French model cannot match a
 * word, and a phone with no on-device recogniser cannot listen without a
 * signal. The hands-free screen states exactly what it got.
 */
export type VoiceStatus = {
  ok: boolean
  /** Permission actually granted. */
  microphone: boolean
  listening: boolean
  /** The recogniser now in use runs on the phone, so no signal is needed. */
  onDevice: boolean
  /** Some recogniser exists, cloud or not. */
  recognizerAvailable: boolean
  /** An on-device one exists and could be used. */
  onDeviceAvailable: boolean
  /** The speech engine woke up and can speak. */
  canSpeak: boolean
  /** False once word recognition has been given up on and only the shout
   *  trigger remains live. */
  words: boolean
  /** The language tag actually in use, or 'default'. Worth showing: a phone
   *  with no French pack falls back to English, which still catches "help"
   *  but will not catch "oskour". */
  language: string
}

const plugin = registerPlugin<CrashResponsePlugin>('CrashResponse')

const unavailable: SimpleResult = { ok: false, message: 'Only in the Android app.' }

/** A long, unmissable buzz. Works on any Android phone with a vibrator,
 *  including the iPhones-excepted case the web build could never serve. */
export async function nativeVibrate(
  pattern?: number[],
  repeat = false,
): Promise<SimpleResult> {
  if (!isNative()) return unavailable
  try {
    return await plugin.vibrate({ ...(pattern ? { pattern } : {}), repeat })
  } catch {
    return { ok: false, message: 'The phone refused to vibrate.' }
  }
}

/** What the phone says about its own vibrator.
 *
 *  "It does not vibrate" has at least six causes and none of them are
 *  visible from a chat window. Reading them off the device turns a guessing
 *  game into one sentence naming the setting to change. */
export type VibrationReport = {
  ok?: boolean
  hasVibrator?: boolean
  hasAmplitudeControl?: boolean
  ringerMode?: 'silent' | 'vibrate' | 'normal'
  alarmVolume?: number
  alarmVolumeMax?: number
  dndFilter?: 'off' | 'priority' | 'alarms-only' | 'total-silence' | 'unknown'
  notificationsEnabled?: boolean
  ringIntensity?: number
  alarmVibrationIntensity?: number
  notificationVibrationIntensity?: number
  sdk?: number
  manufacturer?: string
  model?: string
  usesVibrationAttributes?: boolean
}

export async function vibrationDiagnostics(): Promise<VibrationReport | null> {
  if (!isNative()) return null
  try {
    return await plugin.vibrationDiagnostics()
  } catch {
    return null
  }
}

/** The one sentence worth showing: the most likely reason nothing moved.
 *
 *  Ordered by how completely each cause overrides the app. An intensity
 *  slider at zero beats everything, so it is named first; Do Not Disturb and
 *  silent come next because they are the two people actually have switched
 *  on; and the bottom of the list is the honest "nothing here explains it". */
export function explainNoBuzz(r: VibrationReport | null): string | null {
  if (!r) return null
  if (r.hasVibrator === false) return 'This phone reports no vibration motor at all.'
  if (r.alarmVibrationIntensity === 0)
    return 'Alarm vibration intensity is set to zero in Android settings. Nothing any app does can override that — Settings, Sound and vibration, Vibration intensity.'
  if (r.notificationVibrationIntensity === 0)
    return 'Notification vibration intensity is set to zero in Android settings — Settings, Sound and vibration, Vibration intensity.'
  if (r.dndFilter === 'total-silence')
    return 'Do Not Disturb is set to total silence, which blocks even alarms. Allow alarms, or turn it off.'
  if (r.ringerMode === 'silent')
    return 'The phone is in silent mode. Most makers mute alarm vibration with it; switch to vibrate or normal.'
  if (r.alarmVolume === 0)
    return 'Alarm volume is at zero, so the crash alarm will be silent even though it fires.'
  return null
}

export async function nativeStopVibration(): Promise<SimpleResult> {
  if (!isNative()) return unavailable
  try {
    return await plugin.stopVibration()
  } catch {
    return unavailable
  }
}

/** Text every contact with no tap at all. The one thing a web page may never
 *  do, and the reason the Android build exists. */
export async function nativeSendSms(numbers: string[], message: string): Promise<SmsResult> {
  if (!isNative()) return { ok: false, message: 'Only in the Android app.' }
  const cleaned = numbers.map((n) => n.trim()).filter(Boolean)
  if (cleaned.length === 0) return { ok: false, message: 'No contacts saved.' }
  try {
    return await plugin.sendSms({ numbers: cleaned, message })
  } catch {
    return { ok: false, message: 'The messages could not be sent.' }
  }
}

/** Ring a contact without the dialler.
 *
 *  Android forbids this for emergency numbers from any third-party app, so a
 *  call to 999 or 114 comes back `ok: false` with reason 'emergency-number'
 *  and the caller shows the one-tap button instead. That is not a bug to work
 *  around; it is the rule, and the app is built to respect it.
 */
export async function nativePlaceCall(number: string): Promise<CallResult> {
  if (!isNative()) return { ok: false, message: 'Only in the Android app.' }
  try {
    return await plugin.placeCall({ number })
  } catch {
    return { ok: false, message: 'The call could not be placed.', reason: 'refused' }
  }
}

/** Hand the sensor to the foreground service.
 *
 *  This is what makes crash watch worth arming. A web view is throttled when
 *  it is backgrounded and suspended when the screen goes off, so until this
 *  existed the feature only worked with the app open and the display lit —
 *  which is not how anybody carries a phone while riding.
 *
 *  `notifications` in the result says whether the rider allowed the
 *  notification. The watch runs either way, but without it the alert cannot
 *  show itself on a locked phone, and the UI should say so rather than
 *  implying all is well.
 */
export async function nativeStartWatching(
  threshold: number,
  test: boolean,
): Promise<SimpleResult & { notifications?: boolean }> {
  if (!isNative()) return unavailable
  try {
    return await plugin.startWatching({ threshold, test })
  } catch {
    return { ok: false, message: 'Background watching could not be started.' }
  }
}

export async function nativeStopWatching(): Promise<SimpleResult> {
  if (!isNative()) return unavailable
  try {
    return await plugin.stopWatching()
  } catch {
    return unavailable
  }
}

export async function nativeIsWatching(): Promise<boolean> {
  if (!isNative()) return false
  try {
    return (await plugin.isWatching()).running
  } catch {
    return false
  }
}

/** Subscribe to impacts the service detects. Resolves to an unsubscribe. */
export async function onNativeImpact(
  handler: (impact: NativeImpact) => void,
): Promise<() => void> {
  if (!isNative()) return () => {}
  try {
    const handle = await plugin.addListener('impact', handler)
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** The rest of the measurements for an impact already being shown.
 *
 *  Separate from `impact` because the speed after a crash does not exist at
 *  the moment of the crash: the service needs a few seconds and another
 *  location fix. The alarm never waits for this, which is the point — it
 *  fills in numbers on a screen that is already up. */
export async function onNativeImpactEvidence(
  handler: (impact: NativeImpact) => void,
): Promise<() => void> {
  if (!isNative()) return () => {}
  try {
    const handle = await plugin.addListener('impactEvidence', handler)
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** An impact detected while no page was running — after Android killed the
 *  web view, or before the rider reopened the app. Returns null when there is
 *  nothing waiting, and clears it either way so one crash raises one alert. */
export async function consumePendingImpact(): Promise<NativeImpact | null> {
  if (!isNative()) return null
  try {
    const { hasImpact, ...impact } = await plugin.consumePendingImpact()
    return hasImpact ? impact : null
  } catch {
    return null
  }
}

/**
 * Turn the road scanner on or off in the service.
 *
 * Returns what the service now thinks, including whether it is running at
 * all: the scanner shares the crash watch's sensor rather than holding a
 * second one, so switching it on while crash watch is off arms a preference
 * and logs nothing. The screen says that rather than implying a scan.
 *
 * On the web this is simply false. A browser tab cannot watch an
 * accelerometer with the screen off, so there is no honest passive scanner
 * to offer there.
 */
export async function setRoadScan(
  enabled: boolean,
): Promise<{ ok: boolean; enabled: boolean; watching: boolean }> {
  if (!isNative()) return { ok: false, enabled: false, watching: false }
  try {
    const r = await plugin.setRoadScan({ enabled })
    return { ok: r.ok, enabled: r.enabled, watching: r.watching }
  } catch {
    return { ok: false, enabled: false, watching: false }
  }
}

/** Jolts logged while no page was running, which on a real ride is most of
 *  them. Drained once; the service clears its queue as it hands them over. */
export async function consumePendingJolts(): Promise<NativeJolt[]> {
  if (!isNative()) return []
  try {
    return (await plugin.consumePendingJolts()).jolts ?? []
  } catch {
    return []
  }
}

/** Jolts arriving while the page is alive. Resolves to an unsubscribe. */
export async function onNativeJolt(
  handler: (jolt: NativeJolt) => void,
): Promise<() => void> {
  if (!isNative()) return () => {}
  try {
    const handle = await plugin.addListener('jolt', handler)
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

// ------------------------------------------------------------------- voice

/**
 * Say something out loud.
 *
 * There is no web fallback and there cannot be one: speechSynthesis is
 * undefined in the Android WebView, not merely unsupported, so the browser
 * build stays silent and says so rather than appearing to speak.
 */
export async function nativeSpeak(text: string): Promise<SimpleResult> {
  if (!isNative()) {
    return webSpeak(text)
      ? { ok: true }
      : { ok: false, message: 'This browser has no speech engine.' }
  }
  try {
    return await plugin.speak({ text })
  } catch {
    return { ok: false, message: 'This phone would not speak.' }
  }
}

export async function nativeStopSpeaking(): Promise<SimpleResult> {
  if (!isNative()) {
    webStopSpeaking()
    return { ok: true }
  }
  try {
    return await plugin.stopSpeaking()
  } catch {
    return unavailable
  }
}

/** Begin listening. Asks for the microphone the first time, which is why it
 *  is called from a button the rider pressed and not from app start. */
export async function nativeStartListening(): Promise<SimpleResult & { onDevice?: boolean }> {
  if (!isNative()) {
    const ok = await startWebVoice({
      onHeard: (text, partial) => fanOut(webListeners.heard, { text, partial }),
      onLevel: (level) => fanOut(webListeners.level, level),
      onConfig: (language, onDevice) => fanOut(webListeners.config, { language, onDevice }),
      onWordsLost: (reason) => fanOut(webListeners.wordsLost, reason),
      onFailed: (reason) => fanOut(webListeners.stopped, reason),
    })
    return ok
      ? { ok: true, onDevice: true }
      : { ok: false, message: 'This browser would not start listening.' }
  }
  try {
    return await plugin.startListening()
  } catch {
    return { ok: false, message: 'This phone would not start listening.' }
  }
}

export async function nativeStopListening(): Promise<SimpleResult> {
  if (!isNative()) {
    stopWebVoice()
    return { ok: true }
  }
  try {
    return await plugin.stopListening()
  } catch {
    return unavailable
  }
}

/** On the web every answer is false, which is the truth. */
export async function nativeVoiceStatus(): Promise<VoiceStatus> {
  const none: VoiceStatus = {
    ok: false,
    microphone: false,
    listening: false,
    onDevice: false,
    recognizerAvailable: false,
    onDeviceAvailable: false,
    canSpeak: false,
    language: 'default',
    words: false,
  }
  if (!isNative()) {
    // Measured, not assumed: the same honesty block the app shows, filled
    // in from what this particular browser actually exposes.
    return {
      ...none,
      ok: true,
      microphone: webMicAvailable(),
      listening: webVoiceRunning(),
      onDevice: true,
      recognizerAvailable: webRecognitionAvailable(),
      onDeviceAvailable: false,
      canSpeak: typeof window !== 'undefined' && 'speechSynthesis' in window,
      language: webRecognitionAvailable() ? 'fr-FR' : 'shout-only',
      words: webRecognitionAvailable(),
    }
  }
  try {
    return { ...none, ...(await plugin.voiceStatus()) }
  } catch {
    return none
  }
}

/** Words the phone thought it heard. Partial results arrive too. */
export async function onHeard(
  handler: (data: { text: string; partial: boolean }) => void,
): Promise<() => void> {
  if (!isNative()) {
    webListeners.heard.push(handler as never)
    return () => {
      const at = webListeners.heard.indexOf(handler as never)
      if (at >= 0) webListeners.heard.splice(at, 1)
    }
  }
  try {
    const handle = await plugin.addListener('heard', handler)
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** Raw loudness while listening, which is the trigger that needs no language
 *  and no signal. */
export async function onHearLevel(
  handler: (level: number) => void,
): Promise<() => void> {
  if (!isNative()) {
    webListeners.level.push(handler as never)
    return () => {
      const at = webListeners.level.indexOf(handler as never)
      if (at >= 0) webListeners.level.splice(at, 1)
    }
  }
  try {
    const handle = await plugin.addListener('hearLevel', (d) => handler(d.level))
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** Recognition gave up but the microphone is still open: shouting still
 *  works, words no longer do. Deliberately not the same event as stopping,
 *  because a rider told listening had stopped would stop shouting. */
export async function onHearWordsLost(
  handler: (reason: string) => void,
): Promise<() => void> {
  if (!isNative()) {
    webListeners.wordsLost.push(handler as never)
    return () => {
      const at = webListeners.wordsLost.indexOf(handler as never)
      if (at >= 0) webListeners.wordsLost.splice(at, 1)
    }
  }
  try {
    const handle = await plugin.addListener('hearWordsLost', (d) => handler(d.reason))
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** The engine or language actually in use changed under us — the phone had
 *  no French pack, say, and listening stepped down to English. */
export async function onHearConfig(
  handler: (config: { language: string; onDevice: boolean }) => void,
): Promise<() => void> {
  if (!isNative()) {
    webListeners.config.push(handler as never)
    return () => {
      const at = webListeners.config.indexOf(handler as never)
      if (at >= 0) webListeners.config.splice(at, 1)
    }
  }
  try {
    const handle = await plugin.addListener('hearConfig', handler)
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** Listening gave up, with the reason in words fit for a screen. */
export async function onHearStopped(
  handler: (reason: string) => void,
): Promise<() => void> {
  if (!isNative()) {
    webListeners.stopped.push(handler as never)
    return () => {
      const at = webListeners.stopped.indexOf(handler as never)
      if (at >= 0) webListeners.stopped.splice(at, 1)
    }
  }
  try {
    const handle = await plugin.addListener('hearStopped', (d) => handler(d.reason))
    return () => void handle.remove()
  } catch {
    return () => {}
  }
}

/** What would actually happen if the rider crashed with the phone locked.
 *  On the web every answer is false, which is the truth. */
export async function nativeReadiness(): Promise<Readiness> {
  const none: Readiness = {
    notifications: false,
    sms: false,
    phone: false,
    microphone: false,
    location: false,
    lockScreen: false,
    unrestricted: false,
    watching: false,
  }
  if (!isNative()) return none
  try {
    return await plugin.checkReadiness()
  } catch {
    return none
  }
}

/** Android 14's full-screen-intent screen. There is no runtime prompt for
 *  this one, so sending the rider there is the only way to get it. */
export async function openLockScreenSettings(): Promise<SimpleResult> {
  if (!isNative()) return unavailable
  try {
    return await plugin.openLockScreenSettings()
  } catch {
    return { ok: false, message: 'Could not open that settings screen.' }
  }
}

export async function requestUnrestricted(): Promise<SimpleResult> {
  if (!isNative()) return unavailable
  try {
    return await plugin.requestUnrestricted()
  } catch {
    return { ok: false, message: 'This phone does not expose that setting.' }
  }
}

/** This app's settings page, for when a permission was refused twice and
 *  will never prompt again. */
export async function openAppSettings(): Promise<SimpleResult> {
  if (!isNative()) return unavailable
  try {
    return await plugin.openAppSettings()
  } catch {
    return { ok: false, message: 'Could not open the app settings.' }
  }
}

/**
 * Ask for everything the crash response needs, in one go, before any of it
 * is needed.
 *
 * This exists because of a genuine fault in the first version: SEND_SMS and
 * CALL_PHONE were requested at the moment the app tried to use them, which
 * is immediately after a crash. A rider face-down on a road cannot answer a
 * permission dialog, so the escalation would have stopped dead at exactly
 * the point it mattered — and nothing on screen would have warned them.
 *
 * Capacitor generates this from the aliases the plugin declares, so adding a
 * permission there is enough to have it asked for here.
 */
export async function requestCrashPermissions(): Promise<Readiness> {
  if (!isNative()) return nativeReadiness()
  try {
    await plugin.requestPermissions()
  } catch {
    // A refusal is not an error. What matters is the state afterwards.
  }
  return nativeReadiness()
}
