/** A short medical summary the rider writes once, carried in the crash text.
 *
 * The case for it is the gap between the two people who read that message.
 * A friend needs to know where. An ambulance crew needs to know what not to
 * give you. Crash watch already sends the first; this adds the second, in the
 * same message, at no extra step for someone who is by then unconscious.
 *
 * It is health data, which the Data Protection Act 2017 treats as a special
 * category and which this project has already reasoned about once — see
 * LegalPanel.tsx for crash recordings. The same three answers apply here and
 * the card states all of them:
 *
 *   Minimal     Seven short fields, every one optional, and an empty record
 *               is a valid record. Nothing is asked for that a first
 *               responder would not act on.
 *   Disclosed   The card says where it is stored and who can ever see it, and
 *               offers a one-tap delete that really deletes.
 *   Purpose-    It is written into one message, to the rider's own saved
 *   bound       contacts, and only after a real impact has gone unanswered
 *               through the countdown. Nothing is uploaded; there is no
 *               server to upload it to.
 *
 * Vital interests is the lawful basis, exactly as for the recording: a rider
 * who cannot answer their phone after a crash is the case the Act describes.
 */

export type MedicalId = {
  bloodGroup?: string
  birthYear?: string
  allergies?: string
  medications?: string
  conditions?: string
  kinName?: string
  kinPhone?: string
}

/** Same `zetway.` prefix as zetway.contacts and zetway.permissions.asked. */
const MEDICAL_KEY = 'zetway.medical'

export function readMedicalId(): MedicalId {
  try {
    const raw = localStorage.getItem(MEDICAL_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    // An array or a bare string parses fine and would then be spread into the
    // form as nonsense, so only a plain object is accepted.
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as MedicalId)
      : {}
  } catch {
    return {}
  }
}

export function writeMedicalId(id: MedicalId): void {
  try {
    localStorage.setItem(MEDICAL_KEY, JSON.stringify(id))
  } catch {
    // Saving is a convenience. Crash watch works without any of this.
  }
}

/** The one-tap delete behind the card. Removes the key rather than writing an
 *  empty record, so nothing of it is left on the phone to find. */
export function clearMedicalId(): void {
  try {
    localStorage.removeItem(MEDICAL_KEY)
  } catch {
    // Nothing useful to do, and nothing that depends on it succeeding.
  }
}

export function isMedicalIdEmpty(id: MedicalId): boolean {
  return !Object.values(id).some((v) => typeof v === 'string' && v.trim() !== '')
}

/* How much room is left in the crash text, and where the figures come from.
 *
 * A text in the GSM 7-bit alphabet carries 160 characters on its own. Once it
 * has to be split, seven of every 160 go to the header that lets the handset
 * reassemble the parts, leaving 153 each — 3GPP TS 23.038 for the alphabet,
 * TS 23.040 for the concatenation header. Android splits for us:
 * CrashResponsePlugin.java calls divideMessage then sendMultipartTextMessage.
 *
 * Three parts is the ceiling set here. Beyond that the rider is paying for
 * four or five messages, and the part a dispatcher actually needs is buried.
 *
 * helpMessage() in crashWatch.ts measures 283 characters at its longest: the
 * 63-character opening, a 42-character impact figure that reaches 43 if the
 * crash is over 99g, the 54-character "location unavailable" line, which is
 * longer than the 48-character maps link it replaces, and the 123-character
 * alarm link that carries the position, the impact and a timestamp. One more
 * character goes to the newline that joins the summary on.
 *
 * It was 175 before the alarm link was added, and the budget below is the
 * reason that mattered: this number and the wording in helpMessage are
 * measured against each other, and scripts/check_sms_budget.mjs asserts it
 * rather than trusting that anyone remembered.
 */
const PART_CHARS = 153
const PARTS = 4
const CRASH_MESSAGE_CHARS = 283
export const MEDICAL_SMS_LIMIT = PARTS * PART_CHARS - CRASH_MESSAGE_CHARS - 1

/** Collapse anything pasted in — newlines, double spaces — to one line, so a
 *  field copied out of a prescription cannot break the shape of the text. */
const tidy = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim()

/**
 * The summary as a few short labelled lines, for appending to an SMS.
 *
 * Empty fields are left out completely: a line reading "Allergies:" with
 * nothing after it wastes room and tells a paramedic that the rider answered
 * when they did not.
 *
 * The order is what a first responder acts on first, because that is also the
 * order in which the lines survive a cut.
 *
 * A note on what this does not do: accented characters push the whole text
 * out of the GSM alphabet and into UCS-2, where a part holds 67 characters
 * instead of 153, so "Pénicilline" costs roughly twice what "Penicillin"
 * costs. The summary is not transliterated to prevent it — mangling a drug
 * name or a person's name to save a message is the wrong trade — but the
 * character cap below is what stops it running away.
 */
export function medicalSummary(id: MedicalId, room: number = MEDICAL_SMS_LIMIT): string {
  const kin = [tidy(id.kinName), tidy(id.kinPhone)].filter(Boolean).join(' ')
  const candidates = [
    ['Allergies', tidy(id.allergies)],
    ['Blood', tidy(id.bloodGroup)],
    ['Conditions', tidy(id.conditions)],
    ['Meds', tidy(id.medications)],
    ['Born', tidy(id.birthYear)],
    ['Next of kin', kin],
  ]

  // Never above the ceiling, whatever a caller asks for.
  let left = Math.min(room, MEDICAL_SMS_LIMIT)
  const lines: string[] = []

  for (const [label, value] of candidates) {
    if (!value) continue
    const line = `${label}: ${value}`
    const newline = lines.length > 0 ? 1 : 0
    if (line.length + newline <= left) {
      lines.push(line)
      left -= line.length + newline
      continue
    }
    // The first line that does not fit is cut rather than dropped, because
    // half an allergy is worth more than no allergy, and "..." says plainly
    // that something was cut. Three dots, not an ellipsis character, which is
    // outside the GSM alphabet and would cost the whole message its encoding.
    const space = left - newline - 3
    const head = space > 0 ? line.slice(0, space).trimEnd() : ''
    if (head) lines.push(`${head}...`)
    break
  }

  // Built to fit, then cut to fit anyway. The loop above is the reason the
  // text reads well; this line is the reason it cannot overrun at all.
  return lines.join('\n').slice(0, MEDICAL_SMS_LIMIT)
}
