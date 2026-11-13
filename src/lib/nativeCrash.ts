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

type CrashResponsePlugin = {
  vibrate(options?: { pattern?: number[] }): Promise<SimpleResult>
  stopVibration(): Promise<SimpleResult>
  sendSms(options: { numbers: string[]; message: string }): Promise<SmsResult>
  placeCall(options: { number: string }): Promise<CallResult>
  startWatching(options: { threshold: number; test: boolean }): Promise<
    SimpleResult & { notifications?: boolean }
  >
  stopWatching(): Promise<SimpleResult>
  isWatching(): Promise<{ running: boolean }>
  consumePendingImpact(): Promise<{ hasImpact: boolean; peak: number; test: boolean }>
  addListener(
    event: 'impact',
    handler: (data: NativeImpact) => void,
  ): Promise<PluginListenerHandle>
}

const plugin = registerPlugin<CrashResponsePlugin>('CrashResponse')

const unavailable: SimpleResult = { ok: false, message: 'Only in the Android app.' }

/** A long, unmissable buzz. Works on any Android phone with a vibrator,
 *  including the iPhones-excepted case the web build could never serve. */
export async function nativeVibrate(pattern?: number[]): Promise<SimpleResult> {
  if (!isNative()) return unavailable
  try {
    return await plugin.vibrate(pattern ? { pattern } : undefined)
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
