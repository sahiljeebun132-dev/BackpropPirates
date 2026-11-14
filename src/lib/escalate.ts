import { currentPosition, helpMessage, type EmergencyContact } from './crashWatch'
import { nativePlaceCall, nativeSendSms, openWhatsApp } from './nativeCrash'
import { isNative } from './platform'

/** What the app did, in the order it did it, in words a frightened person can
 *  read. Shown on the alert screen so nobody has to guess whether help knows. */
export type EscalationStep = {
  state: 'done' | 'doing' | 'manual' | 'failed'
  text: string
}

/** Compare two Mauritian numbers written any of the ways people write them.
 *  +230 5 123 4567, 52314567 and 5 123 4567 are all the same phone, so the
 *  last seven digits are the only part worth trusting. */
function sameNumber(a: string, b: string): boolean {
  const tail = (s: string) => s.replace(/\D/g, '').slice(-7)
  return tail(a).length === 7 && tail(a) === tail(b)
}

function nameFor(contacts: EmergencyContact[], number: string): string {
  return contacts.find((c) => sameNumber(c.phone, number))?.name ?? number
}

/** Join names the way a person would say them. */
function listNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Everything that should happen without the rider touching the phone.
 *
 * The web build cannot do any of it: a page may not send a message or place a
 * call, by design, because one that could would be a gift to every scam site.
 * Inside the Android app these are ordinary calls, so the countdown finishing
 * is the last thing that needs a human.
 *
 * One step stays manual on both builds and it is not our choice. Android
 * refuses ACTION_CALL for emergency numbers from any third-party app, and
 * TelecomManager will only place one for the preloaded dialler, so 114 and 999
 * are a button on the screen rather than a call the app makes. The automatic
 * call goes instead to the first saved contact, who is a person who can act:
 * they hear what is happening, they already have the location by text, and
 * they can ring the ambulance themselves.
 */
export async function escalate(
  contacts: EmergencyContact[],
  known: { lat: number; lon: number } | null,
  peak: number | null,
  /** False when the rider is already dialling 114 themselves. The texts still
   *  go out — they carry the location, and a second pair of eyes on the way is
   *  never wrong — but Zetway must not ring a contact into a line that is
   *  being used to call an ambulance. */
  callFirstContact = true,
): Promise<EscalationStep[]> {
  const steps: EscalationStep[] = []

  // The location is the single most useful thing in the message, so it is
  // worth one last attempt if the fix taken at impact has not landed yet.
  const position = known ?? (await currentPosition())
  const message = helpMessage(position, peak)

  if (!isNative()) {
    steps.push({
      state: 'manual',
      text:
        'In the browser Zetway cannot text or call on its own — no web page may. ' +
        'Each button below is one tap.',
    })
    return steps
  }

  if (contacts.length === 0) {
    steps.push({
      state: 'manual',
      text: 'No emergency contacts are saved, so there was nobody to text automatically.',
    })
  } else {
    const sms = await nativeSendSms(
      contacts.map((c) => c.phone),
      message,
    )
    const sent = (sms.sent ?? []).map((n) => nameFor(contacts, n))
    const failed = (sms.failed ?? []).map((n) => nameFor(contacts, n))

    if (sent.length > 0) {
      steps.push({
        state: 'done',
        text: position
          ? `Texted ${listNames(sent)} your location.`
          : `Texted ${listNames(sent)}. Location was not available.`,
      })
    }
    if (failed.length > 0) {
      steps.push({ state: 'failed', text: `Could not text ${listNames(failed)}.` })
    }
    if (sent.length === 0 && failed.length === 0) {
      steps.push({ state: 'failed', text: sms.message ?? 'No messages could be sent.' })
    }

    // Ring the first contact. Theirs is an ordinary number, which Android does
    // allow an app to dial, so this needs no tap.
    const first = contacts[0]
    if (!callFirstContact) {
      steps.push({
        state: 'manual',
        text: `Did not ring ${first.name}, so the line stays free for your call.`,
      })
      return steps
    }
    const call = await nativePlaceCall(first.phone)
    if (call.ok) {
      steps.push({ state: 'doing', text: `Calling ${first.name} now.` })
    } else if (call.reason === 'permission-denied') {
      steps.push({
        state: 'manual',
        text: `Zetway was not allowed to place calls, so ${first.name} has not been rung. Tap below.`,
      })
    } else {
      steps.push({
        state: 'manual',
        text: `Could not ring ${first.name} automatically. Tap below.`,
      })
    }

    // WhatsApp last, so it is what is on screen when somebody picks the
    // phone up, and after the call rather than before it — launching an
    // activity mid-dial would bury the one thing that is already working.
    //
    // The send itself stays the rider's tap and no amount of permission
    // changes that: WhatsApp publishes no send API to other apps. What this
    // removes is everything before the tap — finding the app, finding the
    // contact, and typing a location nobody can type one-handed at the
    // roadside. Not reached when the rider is dialling 114 themselves,
    // because that path has already returned above.
    const wa = await openWhatsApp(first.phone, message)
    steps.push(
      wa.ok
        ? {
            state: 'manual',
            text: `WhatsApp is open on ${first.name} with the message already written. One tap sends it.`,
          }
        : {
            state: 'manual',
            text: wa.message ?? 'Could not open WhatsApp on this phone.',
          },
    )
  }

  steps.push({
    state: 'manual',
    text:
      'Android does not let any app dial 114 or 999 by itself — only the phone’s own dialler may. ' +
      'The button below is one tap.',
  })

  return steps
}
