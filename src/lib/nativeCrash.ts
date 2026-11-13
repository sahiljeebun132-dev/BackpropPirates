import { registerPlugin } from '@capacitor/core'

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

type CrashResponsePlugin = {
  vibrate(options?: { pattern?: number[] }): Promise<SimpleResult>
  stopVibration(): Promise<SimpleResult>
  sendSms(options: { numbers: string[]; message: string }): Promise<SmsResult>
  placeCall(options: { number: string }): Promise<CallResult>
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
