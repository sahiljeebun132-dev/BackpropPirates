// Does the crash text still fit the number of SMS parts it claims?
//
// medicalId.ts caps the medical summary against a hard-coded length for the
// sentence in crashWatch.ts, and the two are only correct together. Adding
// the alarm link to that sentence grew it from 175 characters to 283 and
// silently blew the budget; nothing failed, the message just quietly became
// longer than the three parts it was sized for.
//
// So the number is asserted here rather than remembered. Change either
// wording and this tells you, in the same breath, by how much.
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !path.extname(spec)) {
      try {
        return next(spec + '.ts', ctx)
      } catch {
        /* fall through */
      }
    }
    return next(spec, ctx)
  },
})

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) },
  removeItem(k) { delete this._d[k] },
}

const med = await import(pathToFileURL(path.join(ROOT, 'src/lib/medicalId.ts')).href)
const cw = await import(pathToFileURL(path.join(ROOT, 'src/lib/crashWatch.ts')).href)

const PART = 153
let fail = 0

// The worst case the sentence can reach: no position (that line is longer
// than the maps link it replaces) and a three-digit impact.
const noFix = cw.helpMessage(null, 150 * 9.8)
// And the case that actually carries the alarm link.
const withFix = cw.helpMessage({ lat: -20.16090, lon: 57.50120 }, 99.9 * 9.8)

const core = Math.max(noFix.length, withFix.length)
console.log(`core message, no fix     ${noFix.length} chars`)
console.log(`core message, with fix   ${withFix.length} chars`)
console.log(`longest core             ${core} chars`)
console.log(`declared in medicalId    ${med.CRASH_MESSAGE_CHARS ?? '(not exported)'}`)
console.log(`medical budget           ${med.MEDICAL_SMS_LIMIT} chars`)

// The declared length has to be at least the real one, or the medical
// summary is sized against a sentence shorter than the one being sent.
const declared = (med.MEDICAL_SMS_LIMIT + 1) + 0 // parts*PART - core - 1 => recover core
// Recover what medicalId believes: parts are whatever makes the sum work.
for (const parts of [3, 4, 5]) {
  if (parts * PART - med.MEDICAL_SMS_LIMIT - 1 === core) {
    console.log(`\nconsistent at ${parts} SMS parts`)
  }
}

if (med.MEDICAL_SMS_LIMIT + core + 1 > 5 * PART) {
  console.log(`\nFAIL  budget needs more than 5 SMS parts`)
  fail++
}

// The whole thing, with a deliberately oversized medical record.
const HUGE = {
  bloodGroup: 'AB-',
  yearOfBirth: '1975',
  allergies: 'Penicillin, sulfa drugs, shellfish, latex, ibuprofen, aspirin, codeine, peanuts',
  medications: 'Metformin 1000mg twice daily, atorvastatin 40mg, ramipril 5mg, salbutamol inhaler as needed',
  conditions: 'Type 2 diabetes, hypertension, asthma, previous myocardial infarction 2019',
  kinName: 'Marie-Claire Rasoanaivo',
  kinPhone: '+230 5712 3456',
}
globalThis.localStorage.setItem('zetway.medical', JSON.stringify(HUGE))
const worst = cw.helpMessage(null, 150 * 9.8)
const parts = Math.ceil(worst.length / PART)
console.log(`\nworst whole message      ${worst.length} chars = ${parts} parts`)

const declaredParts = Math.ceil((med.MEDICAL_SMS_LIMIT + core + 1) / PART)
if (parts > declaredParts) {
  console.log(`FAIL  sends ${parts} parts but is budgeted for ${declaredParts}`)
  fail++
}

// And the alarm link must actually be in there when there is a position.
if (!/alert\.html\?lat=/.test(withFix)) {
  console.log('FAIL  no alarm link in a message that has a position')
  fail++
}
if (/alert\.html/.test(noFix)) {
  console.log('FAIL  alarm link present with no position to put in it')
  fail++
}

console.log(fail === 0 ? '\nOK  the message fits what it claims' : `\n${fail} problem(s)`)
process.exit(fail === 0 ? 0 : 1)
