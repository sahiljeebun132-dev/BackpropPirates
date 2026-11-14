// Does the phone understand a cry for help, and — far more important — does
// it ever mistake one for the opposite?
//
// Most of the cases below are here because an adversarial review found them
// by running the matcher rather than reading it. Three of them were real
// enough to kill somebody:
//
//   "Mo Bondie"            the commonest Mauritian cry of pain, read as a
//                          cancel because the root 'mo bon' sat inside it
//   "I can't stop the      read as a cancel because the bare token 'stop'
//    bleeding"             appeared anywhere in the sentence
//   "I can't move"         matched nothing at all, because flattening turned
//                          the apostrophe into a space
//
// Every one of them now has a line in this file.
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

const sos = await import(pathToFileURL(path.join(ROOT, 'src/lib/sosVoice.ts')).href)

let pass = 0
let fail = 0

function check(label, got, want) {
  const ok = got === want
  if (ok) pass++
  else {
    fail++
    console.log(`  FAIL  ${label}\n        got ${got}, wanted ${want}`)
  }
}

// --------------------------------------------------------------- the words

console.log('\nCries for help, as a French recogniser would render them')
for (const [text, want] of [
  // Confirming the countdown out loud. The alert is already asking "are you
  // alright?", so these are answers to a question, not reports of an injury.
  // Each affirmative is paired with the negation it must not be confused
  // with: a bare 'call' would sit inside every one of the cancels below,
  // which is the same shape as 'mo bon' hiding inside 'mo Bondie'.
  ['please call', 'distress'],
  ['yes call them', 'distress'],
  ['call for help', 'distress'],
  ['call someone now', 'distress'],
  ['apel sekour', 'distress'],
  ['please dont call', 'cancel'],
  ['please do not call anyone', 'cancel'],
  ['no need to call, im fine', 'cancel'],
  ['pa apel personne', 'cancel'],
  ['dont call an ambulance', 'cancel'],

  ['help', 'distress'],
  ['help me please', 'distress'],
  ['HELP', 'distress'],
  ['au secours', 'distress'],
  ["au s'cours aidez moi", 'distress'],
  ['oskour', 'distress'],
  ['o sekour mo blese', 'distress'],
  ['ambulance', 'distress'],
  ['appelez une ambulance', 'distress'],
  ['mo pa kapav bouze', 'distress'],
  ['urgence', 'distress'],
  ['aid mwa', 'distress'],
]) {
  check(JSON.stringify(text), sos.hearSos(text), want)
}

console.log('\nApostrophes — these matched nothing until the review')
for (const text of [
  "I can't move",
  "I'm hurt",
  "I can't breathe",
  "I'm bleeding",
  "I'm trapped",
  "I’m hurt", // a recogniser's curly apostrophe, not a typo
]) {
  check(JSON.stringify(text), sos.hearSos(text), 'distress')
}

console.log('\n"Mo Bondie" — the one that read as its own opposite')
for (const text of [
  'Mo Bondie',
  'mo bondie ed mwa',
  'Ayo, mo Bondie, ed mwa!',
  'mo bon dieu',
  'mo bondye',
  'ayo',
]) {
  check(JSON.stringify(text), sos.hearSos(text), 'distress')
}

console.log('\nA cancel word inside a cry for help — distress has to win')
for (const text of [
  "Help, I can't stop the bleeding",
  "I can't stop the bleeding",
  "it won't stop bleeding",
  'stop the bleeding help me',
  "my leg won't stop bleeding help",
  'help no stop im fine',
]) {
  check(JSON.stringify(text), sos.hearSos(text), 'distress')
}

console.log('\nCalling it off')
for (const [text, want] of [
  ['stop', 'cancel'],
  ['stop stop stop', 'cancel'],
  ['mo korek', 'cancel'],
  ['tout korek', 'cancel'],
  ['I am fine', 'cancel'],
  ['false alarm', 'cancel'],
  ['annuler', 'cancel'],
  ['arete', 'cancel'],
  ['arretez', 'cancel'],
  ['pa bizin', 'cancel'],
  ['ca va bien', 'cancel'],
  ['no', 'cancel'],
  ["I don't need help", 'cancel'],
  ['no ambulance', 'cancel'],
  ["don't call", 'cancel'],
]) {
  check(JSON.stringify(text), sos.hearSos(text), want)
}

console.log('\nNegated — none of these may read as "cancel"')
for (const text of [
  'ca va pas',
  'ça va pas du tout',
  'mo pa korek',
  'I am not fine',
  'im not ok',
  'i am not ok',
  'pa korek ditou',
]) {
  const got = sos.hearSos(text)
  if (got !== 'cancel') pass++
  else {
    fail++
    console.log(`  FAIL  ${JSON.stringify(text)}\n        read as cancel`)
  }
}

console.log('\nOrdinary talk, which must do nothing at all')
for (const text of [
  '',
  'il fait beau aujourd hui',
  'mo pe al travay',
  'turn left at the roundabout',
  'what time is it',
  'quatre bornes',
  'delo lor sime',
]) {
  check(JSON.stringify(text), sos.hearSos(text), null)
}

console.log('\nThe phone must never act on its own prompts')
for (const line of [
  'Zetway detected a heavy impact. Speak now to answer: say that you are all right to call this off, or ask for an ambulance to send for one.',
  'I heard you. Getting help in 10 seconds. Say the word fine to call it off.',
  'I heard shouting. Getting help in 15 seconds. Say the word fine to call it off.',
  'Listening.',
  'Called off. Still listening.',
]) {
  const got = sos.hearSos(line)
  // 'Getting help now' legitimately contains help; it is only ever said
  // after the decision, and the deaf window covers it. Everything the phone
  // says *before* a decision has to be inert.
  if (got !== 'cancel') pass++
  else {
    fail++
    console.log(`  FAIL  the app's own line cancels itself:\n        ${line}`)
  }
}

console.log('\nWhat the screen promises, the matcher must deliver')
for (const phrase of sos.SOS_PHRASES) {
  check(`SOS_PHRASES ${JSON.stringify(phrase)}`, sos.hearSos(phrase), 'distress')
}
for (const phrase of sos.CANCEL_PHRASES) {
  check(`CANCEL_PHRASES ${JSON.stringify(phrase)}`, sos.hearSos(phrase), 'cancel')
}

// ------------------------------------------------------------- the shouting

console.log('\nShouting, against a noisy background')

/** Feed a level for a span of milliseconds at 10 samples a second, which is
 *  what both level sources deliver. */
function feed(d, level, ms, t0) {
  let fired = false
  for (let t = t0; t < t0 + ms; t += 100) {
    if (d.push(level, t)) fired = true
  }
  return fired
}

{
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 3000, 0)
  check('shout in a quiet room fires', feed(d, 8.0, 2000, 3000), true)
}

{
  const d = new sos.ShoutDetector()
  feed(d, 5.0, 4000, 0)
  check('shout over engine noise fires', feed(d, 9.0, 2000, 4000), true)
}

{
  const d = new sos.ShoutDetector()
  check('steady engine noise alone does not fire', feed(d, 5.0, 20000, 0), false)
}

{
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 3000, 0)
  check('a 400ms horn does not fire', feed(d, 9.0, 400, 3000), false)
}

{
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 2000, 0)
  check('ordinary speech does not fire', feed(d, 3.0, 5000, 2000), false)
}

{
  // Two separate bangs 1.3s apart. The span test alone used to accept this,
  // which is a car door closing twice rather than a person shouting.
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 3000, 0)
  let fired = false
  if (d.push(9.0, 3000)) fired = true
  if (d.push(9.0, 4300)) fired = true
  check('two separate bangs do not fire', fired, false)
}

{
  // Already shouting when the microphone opens. Seeding the baseline from
  // the first sample made the shout the definition of quiet, and it could
  // then never be heard.
  //
  // The shout has a breath in it, because every real one does, and because
  // a level that never changes at all genuinely is the background — there
  // is nothing there to detect and nothing this detector could honestly
  // do about it. The breath is what lets the baseline fall back to the
  // room, after which the next burst clears the margin.
  const d = new sos.ShoutDetector()
  feed(d, 8.0, 1200, 0)      // already shouting as the mic opens
  feed(d, 1.5, 600, 1200)    // drawing breath
  const fired = feed(d, 8.0, 2000, 1800)
  check('a shout already under way is still heard', fired, true)
}

{
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 3000, 0)
  let count = 0
  for (let t = 3000; t < 8000; t += 100) if (d.push(8.0, t)) count++
  check('one continuous shout triggers once', count, 1)
}

{
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 2000, 0)
  feed(d, 8.0, 8000, 2000)
  const after = d.quietLevel
  if (after !== null && after < 5.0) pass++
  else {
    fail++
    console.log(`  FAIL  baseline crept to ${after?.toFixed(2)} during a long shout`)
  }
}

{
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 2000, 0)
  feed(d, 7.0, 1500, 2000)
  if (d.peakOver >= 5) pass++
  else {
    fail++
    console.log(`  FAIL  peak gap recorded as ${d.peakOver.toFixed(2)}, expected about 6`)
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
