import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

import { isNative } from './platform'

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

export type NativeImpact = { peak: number; test: boolean }

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
  stopVibration(): Promise<SimpleResult>
  sendSms(options: { numbers: string[]; message: string }): Promise<SmsResult>
  placeCall(options: { number: string }): Promise<CallResult>
  startWatching(options: { threshold: number; test: boolean }): Promise<
    SimpleResult & { notifications?: boolean }
  >
  stopWatching(): Promise<SimpleResult>
  isWatching(): Promise<{ running: boolean }>
  consumePendingImpact(): Promise<{ hasImpact: boolean; peak: number; test: boolean }>
  checkReadiness(): Promise<Readiness>
  requestPermissions(): Promise<Record<string, string>>
  openLockScreenSettings(): Promise<SimpleResult>
  requestUnrestricted(): Promise<SimpleResult>
  openAppSettings(): Promise<SimpleResult>
  addListener(
    event: 'impact',
    handler: (data: NativeImpact) => void,
  ): Promise<PluginListenerHandle>
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

/** An impact detected while no page was running — after Android killed the
 *  web view, or before the rider reopened the app. Returns null when there is
 *  nothing waiting, and clears it either way so one crash raises one alert. */
export async function consumePendingImpact(): Promise<NativeImpact | null> {
  if (!isNative()) return null
  try {
    const r = await plugin.consumePendingImpact()
    return r.hasImpact ? { peak: r.peak, test: r.test } : null
  } catch {
    return null
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
